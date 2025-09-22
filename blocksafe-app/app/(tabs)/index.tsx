import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Alert,
  Dimensions,
  Animated
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer'; // Needed for Twilio auth

// Use your actual backend URL based on your network
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://172.20.10.2:3001/api/upload';
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
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
 
  // Animation values for radar effect
  const radarAnimation1 = useRef(new Animated.Value(0)).current;
  const radarAnimation2 = useRef(new Animated.Value(0)).current;
  const radarAnimation3 = useRef(new Animated.Value(0)).current;
 
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

  // Start radar animation when guard is active
  useEffect(() => {
    if (isGuardActive) {
      const createRadarAnimation = (animValue: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(animValue, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: true,
            }),
            Animated.timing(animValue, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const radar1 = createRadarAnimation(radarAnimation1, 0);
      const radar2 = createRadarAnimation(radarAnimation2, 600);
      const radar3 = createRadarAnimation(radarAnimation3, 1200);

      Animated.parallel([radar1, radar2, radar3]).start();
    } else {
      // Reset animations
      radarAnimation1.setValue(0);
      radarAnimation2.setValue(0);
      radarAnimation3.setValue(0);
    }
  }, [isGuardActive]);

  const convertAudioToBase64 = async (uri: string): Promise<string | null> => {
    try {
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
    
    // [FIX] Correctly format the Google Maps URL
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
      console.log(`
    ┌──────────────────────────────────────────┐
    │ 🚨 Twilio Alert Sent                     │
    ├──────────────────────────────────────────┤
    │ ✅ Emergency contact has been notified.  │
    └──────────────────────────────────────────┘
      `);
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
   
    try {
      const audioBase64 = await convertAudioToBase64(uri);
      if (!audioBase64) {
        setStatusText('Error: Could not process audio file');
        return;
      }

      const geminiAnalysis = await analyzeAudioWithGemini(audioBase64);
      console.log(`
    ┌──────────────────────────────────────────┐
    │ 🧠 BlockSafe AI Analysis                 │
    ├──────────────────────────────────────────┤
    │ Result: ${geminiAnalysis.trim()}                  │
    └──────────────────────────────────────────┘
      `);
     
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
          timeout: 30000
        });
        const verdict = response.data.message || geminiAnalysis;
        setStatusText(verdict);
        console.log('✅ Backend responded:', response.data);
      } catch (backendError) {
        console.log('Backend unavailable, using BlockSafe analysis only');
        setStatusText(geminiAnalysis);
      }

      if (geminiAnalysis.toLowerCase().includes('alert') ||
          geminiAnalysis.toLowerCase().includes('danger')) {
        Alert.alert(
          "⚠️ Alert Triggered!",
          "Distress signal detected. Notifying emergency services and contact.",
          [{ text: "OK", style: "default" }]
        );
        await sendTwilioAlert();
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
    setStatusText('Running');
    try {
      const locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 10000,
          distanceInterval: 10
        },
        (newLocation: LocationData) => {
          setLocation(newLocation);
          console.log(`
    ┌──────────────────────────────────────────┐
    │ 📍 Location Update                       │
    ├──────────────────────────────────────────┤
    │ Latitude:  ${newLocation.coords.latitude}     │
    │ Longitude: ${newLocation.coords.longitude}    │
    └──────────────────────────────────────────┘
          `);
        }
      );
      locationSubscriberRef.current = locationSubscription;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      });
     
      const recordingOptions: Audio.RecordingOptions = {
        android: { extension: '.wav', outputFormat: Audio.AndroidOutputFormat.DEFAULT, audioEncoder: Audio.AndroidAudioEncoder.DEFAULT, sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 },
        ios: { extension: '.wav', audioQuality: Audio.IOSAudioQuality.HIGH, sampleRate: 44100, numberOfChannels: 2, bitRate: 128000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
        web: { mimeType: 'audio/wav', bitsPerSecond: 128000 }
      };
     
      const { recording: newRecording } = await Audio.Recording.createAsync(recordingOptions);
      recordingRef.current = newRecording;
     
      setIsGuardActive(true);

    } catch (err) {
      console.error('Failed to start guard:', err);
      setStatusText('Failed to Activate');
      Alert.alert('Error', 'Could not start protection. Please check permissions.');
    }
  };

  const stopGuard = async (): Promise<void> => {
    setStatusText('Stopping...');
   
    const recordingToStop = recordingRef.current;
    if (!recordingToStop) {
      return;
    }
   
    recordingRef.current = null;
   
    try {
      const uri = recordingToStop.getURI();
      await recordingToStop.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      
      console.log(`
    ┌──────────────────────────────────────────┐
    │ 🎙️  Recording Stopped & Ready for Upload   │
    ├──────────────────────────────────────────┤
    │ URI: ${uri || 'N/A'}                       │
    └──────────────────────────────────────────┘
      `);
     
      if (uri) {
        await handleFileUpload(uri);
      }
      
      if (locationSubscriberRef.current) {
        locationSubscriberRef.current.remove();
        locationSubscriberRef.current = null;
      }
     
      setIsGuardActive(false);
    } catch (error) {
      console.error('❌ Error stopping guard:', error);
      setStatusText('Error stopping guard');
    }
  };
 
  const handlePress = (): void => {
    if (isGuardActive) {
      stopGuard();
    } else {
      startGuard();
    }
  };

  const renderRadarRings = () => {
    const rings = [radarAnimation1, radarAnimation2, radarAnimation3];
    return rings.map((animation, index) => (
      <Animated.View
        key={index}
        style={[
          styles.radarRing,
          {
            opacity: animation.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
          },
        ]}
      />
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1d29" />
      <View style={styles.header}>
        <View style={styles.userIcon}>
          <Text style={styles.userIconText}>👤</Text>
        </View>
        <Text style={styles.appTitle}>BlockSafe</Text>
      </View>
      {statusText === 'Disturbance detected' && (
        <View style={styles.alertNotification}>
          <Text style={styles.alertIcon}>⚠️</Text>
          <Text style={styles.alertText}>Disturbance detected</Text>
          <Text style={styles.alertSubtext}>Analyzing voice data</Text>
        </View>
      )}
      <View style={styles.statusContainer}>
        <View style={[styles.statusItem, isGuardActive && styles.statusItemActive]}>
          <Text style={styles.statusIcon}>🎤</Text>
        </View>
        <View style={[styles.statusItem, isGuardActive && styles.statusItemActive]}>
          <Text style={styles.statusIcon}>📱</Text>
        </View>
        <View style={[styles.statusItem, isGuardActive && styles.statusItemActive]}>
          <Text style={styles.statusIcon}>📷</Text>
        </View>
      </View>
      <Text style={styles.statusText}>{statusText}</Text>
      <View style={styles.buttonContainer}>
        {isGuardActive && (
          <View style={styles.radarContainer}>
            {renderRadarRings()}
          </View>
        )}
        <TouchableOpacity
          style={[styles.mainButton, isGuardActive && styles.mainButtonActive]}
          onPress={handlePress}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, isGuardActive && styles.buttonTextActive]}>
            {isGuardActive ? 'STOP' : 'START'}
          </Text>
        </TouchableOpacity>
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
    backgroundColor: '#1a1d29',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  userIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  userIconText: {
    fontSize: 20,
    color: '#ffffff',
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ff4757',
    letterSpacing: 1,
  },
  alertNotification: {
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 71, 87, 0.3)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  alertText: {
    color: '#ff4757',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  alertSubtext: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    gap: 30,
  },
  statusItem: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statusItemActive: {
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
    borderColor: 'rgba(255, 71, 87, 0.4)',
  },
  statusIcon: {
    fontSize: 20,
  },
  statusText: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 80,
    textAlign: 'center',
  },
  buttonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  radarContainer: {
    position: 'absolute',
    width: 300,
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#ff4757',
  },
  mainButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#ff4757',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ff4757',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
    zIndex: 10,
  },
  mainButtonActive: {
    backgroundColor: '#ff4757',
    shadowRadius: 30,
    shadowOpacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  buttonTextActive: {
    color: '#ffffff',
  },
});