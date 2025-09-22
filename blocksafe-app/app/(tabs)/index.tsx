import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  StatusBar, 
  Alert,
  Dimensions 
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer'; // Needed for Twilio auth

// Use your actual backend URL based on your network
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://172.20.10.2:3001/api/upload'; 
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'AIzaSyCEAp-Qsi3dqtUdFGE3Cdcod5_8AIM8Iig';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const { width, height } = Dimensions.get('window');

interface LocationCoords {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

interface LocationData {
  coords: LocationCoords;
  timestamp: number;
}

function AppContent() {
  const [isGuardActive, setIsGuardActive] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('Idle');
  const [location, setLocation] = useState<LocationData | null>(null);
  
  // Use useRef to manage the recording object to prevent crashes
  const recordingRef = useRef<Audio.Recording | null>(null);
  const locationSubscriberRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
        if (locationStatus !== 'granted') {
          Alert.alert('Permission Denied', 'Location permission is required for this app to work properly.');
        } else {
          const currentLocation = await Location.getCurrentPositionAsync({});
          setLocation(currentLocation);
        }
        
        const { status: audioStatus } = await Audio.requestPermissionsAsync();
        if (audioStatus !== 'granted') {
          Alert.alert('Permission Denied', 'Audio recording permission is required for this app to work properly.');
        }
      } catch (error) {
        console.error('Error requesting permissions:', error);
      }
    })();
  }, []);

  const convertAudioToBase64 = async (uri: string): Promise<string | null> => {
    try {
      // Using legacy API to avoid deprecation errors
      const base64 = await FileSystem.readAsStringAsync(uri, { 
        encoding: 'base64'
      });
      return base64;
    } catch (error) {
      console.error('Error converting audio to base64:', error);
      return null;
    }
  };

  const analyzeAudioWithGemini = async (audioBase64: string): Promise<string> => {
    try {
      const response = await axios.post(
        GEMINI_API_URL,
        {
          contents: [{
            parts: [
              {
                text: "Analyze this audio recording and determine if there are any signs of distress, emergency, or safety concerns. Respond with: ALERT if there's danger, WARNING if something seems concerning, or SAFE if everything appears normal. Provide a brief explanation."
              },
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: audioBase64
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 1,
            maxOutputTokens: 256
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return response.data.candidates[0].content.parts[0].text;
      } else {
        return "Unable to analyze audio";
      }
    } catch (error) {
      console.error('BlockSafe API Error:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
      }
      return "Error analyzing audio with Gemini";
    }
  };

  const sendTwilioAlert = async (): Promise<void> => {
    if (!location) {
      Alert.alert("Location Error", "Cannot send alert without user location.");
      return;
    }

    setStatusText('Notifying emergency contact...');
    const locationUrl = `https://www.google.com/maps?q=${location.coords.latitude},${location.coords.longitude}`;
    const message = `EMERGENCY: A distress signal was detected by BlockSafe. Location: ${locationUrl}`;
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.EXPO_PUBLIC_TWILIO_ACCOUNT_SID}/Messages.json`;
    const encodedCredentials = Buffer.from(`${process.env.EXPO_PUBLIC_TWILIO_ACCOUNT_SID}:${process.env.EXPO_PUBLIC_TWILIO_AUTH_TOKEN}`).toString('base64');
    
    const body = new URLSearchParams({
      'To': process.env.EXPO_PUBLIC_EMERGENCY_CONTACT_PHONE_NUMBER || '',
      'From': process.env.EXPO_PUBLIC_TWILIO_PHONE_NUMBER || '',
      'Body': message,
    }).toString();

    try {
      await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${encodedCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      console.log('✅ Twilio message sent successfully.');
      Alert.alert('Alert Sent', 'Your emergency contact has been notified.');
      setStatusText('Emergency contact notified');
    } catch (error) {
      console.error('CRITICAL: Twilio SMS failed:', error);
      Alert.alert('SMS Error', 'Failed to send emergency SMS.');
      setStatusText('SMS failed to send');
    }
  };

  const handleFileUpload = async (uri: string | null): Promise<void> => {
    if (!uri) {
      setStatusText('Recording failed.');
      return;
    }
    
    setStatusText('Analyzing audio...');
    console.log("Processing audio from URI:", uri);
    
    try {
      // Convert audio to base64 for Gemini API
      const audioBase64 = await convertAudioToBase64(uri);
      
      if (!audioBase64) {
        setStatusText('Error: Could not process audio file');
        return;
      }

      // Analyze with Gemini
      const geminiAnalysis = await analyzeAudioWithGemini(audioBase64);
      console.log('BlockSafe Analysis:', geminiAnalysis);
      
      // Send to backend for blockchain storage
      const formData = new FormData();
      const fileInfo: any = {
        uri: uri,
        name: `recording-${Date.now()}.wav`,
        type: 'audio/wav',
      };
      formData.append('media_file', fileInfo);
      formData.append('gemini_analysis', geminiAnalysis);

      try {
        const response = await axios.post(API_URL, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30000 // 30 second timeout
        });
        
        const verdict = response.data.message || geminiAnalysis;
        setStatusText(verdict);
        console.log('✅ Backend responded:', response.data);
      } catch (backendError) {
        // If backend fails, still show Gemini analysis
        console.log('Backend unavailable, using BlockSafe analysis only');
        setStatusText(geminiAnalysis);
      }

      // Alert and send Twilio message if danger detected
      if (geminiAnalysis.toLowerCase().includes('alert') || 
          geminiAnalysis.toLowerCase().includes('danger')) {
        Alert.alert(
          "⚠️ Alert Triggered!", 
          "Distress signal detected. Notifying emergency services and contact.",
          [{ text: "OK", style: "default" }]
        );
        await sendTwilioAlert(); // Send the SMS
      } else if (geminiAnalysis.toLowerCase().includes('warning')) {
        Alert.alert(
          "⚠️ Warning", 
          geminiAnalysis,
          [{ text: "OK", style: "default" }]
        );
      }

    } catch (error) {
      console.error('❌ Error processing audio:', error);
      setStatusText('Error: Analysis failed.');
      Alert.alert('Error', 'Could not analyze the audio. Please try again.');
    }
  };

  const startGuard = async (): Promise<void> => {
    setStatusText('Activating...');
    try {
      // Start Location Tracking
      const locationSubscription = await Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.BestForNavigation, 
          timeInterval: 10000, 
          distanceInterval: 10 
        },
        (newLocation: LocationData) => { 
          setLocation(newLocation);
          console.log('📍 Location:', newLocation.coords.latitude, newLocation.coords.longitude); 
        }
      );
      locationSubscriberRef.current = locationSubscription;

      // Configure and start Audio Recording
      await Audio.setAudioModeAsync({ 
        allowsRecordingIOS: true, 
        playsInSilentModeIOS: true 
      });
      
      const recordingOptions: Audio.RecordingOptions = {
        android: {
          extension: '.wav',
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/wav',
          bitsPerSecond: 128000,
        }
      };
      
      const { recording: newRecording } = await Audio.Recording.createAsync(
        recordingOptions
      );
      recordingRef.current = newRecording;
      
      setStatusText('🛡️ Actively Protecting');
      setIsGuardActive(true);

    } catch (err) {
      console.error('Failed to start guard:', err);
      setStatusText('Failed to Activate');
      Alert.alert('Error', 'Could not start protection. Please check permissions.');
    }
  };

  const stopGuard = async (): Promise<void> => {
    setStatusText('Stopping...');
    
    try {
      // Check the ref directly for more reliability
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = recordingRef.current.getURI(); 
        console.log('🎙️ Recording stopped, URI:', uri);
        
        // Send the recording for analysis
        await handleFileUpload(uri);
        recordingRef.current = null;
      }
      
      if (locationSubscriberRef.current) {
        locationSubscriberRef.current.remove();
        locationSubscriberRef.current = null;
      }
      
      setIsGuardActive(false);
    } catch (error) {
      console.error('Error stopping guard:', error);
      setStatusText('Error stopping guard');
      // Force clear ref on error
      recordingRef.current = null;
    }
  };
  
  const handlePress = (): void => { 
    if (isGuardActive) {
      stopGuard();
    } else {
      startGuard();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Red glow overlay when guard is active */}
      {isGuardActive && (
        <View style={styles.redGlowOverlay} />
      )}
      
      <View style={styles.headerContainer}>
        <Text style={styles.title}>BlockSafe</Text>
        <Text style={styles.subtitle}>Blockchain Security Guardian</Text>
        <Text style={styles.statusText}>
          {statusText}
        </Text>
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.guardButton, isGuardActive && styles.guardButtonActive]} 
          onPress={handlePress}
          activeOpacity={0.8}
        >
          <View style={[styles.buttonInner, isGuardActive && styles.buttonInnerActive]}>
            <Text style={[styles.buttonText, isGuardActive && styles.buttonTextActive]}>
              {isGuardActive ? 'STOP GUARD' : 'START GUARD'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
      
      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>Secured by Blockchain Technology</Text>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)',
    // backgroundColor: '#0f1419', // Fallback for React Native
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  redGlowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    borderWidth: 8,
    borderColor: '#ff4757',
    borderRadius: 0,
    shadowColor: '#ff4757',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 30,
  },
  headerContainer: {
    alignItems: 'center',
    paddingTop: 60,
    width: '100%',
    zIndex: 2,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#4fc3f7',
    marginBottom: 8,
    textShadowColor: '#2196f3',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#81c784',
    marginBottom: 20,
    opacity: 0.8,
  },
  statusText: {
    fontSize: 20,
    color: '#e3f2fd',
    fontWeight: '500',
    textAlign: 'center',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  buttonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  guardButton: {
    width: 220,
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 110,
    backgroundColor: 'transparent',
    borderWidth: 4,
    borderColor: '#4fc3f7',
    shadowColor: '#2196f3',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 25,
    elevation: 15,
  },
  guardButtonActive: {
    borderColor: '#ff4757',
    shadowColor: '#ff4757',
    shadowRadius: 35,
  },
  buttonInner: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(79, 195, 247, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(79, 195, 247, 0.5)',
  },
  buttonInnerActive: {
    backgroundColor: 'rgba(255, 71, 87, 0.3)',
    borderColor: 'rgba(255, 71, 87, 0.7)',
  },
  buttonText: {
    color: '#4fc3f7',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: '#2196f3',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  buttonTextActive: {
    color: '#ff4757',
    textShadowColor: '#ff4757',
  },
  footerContainer: {
    alignItems: 'center',
    paddingBottom: 30,
    zIndex: 2,
  },
  footerText: {
    color: 'rgba(227, 242, 253, 0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
});