import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';

export default function App() {
  const [isGuarding, setIsGuarding] = useState(false);
  const [recording, setRecording] = useState();
  const [permissionResponse, requestPermission] = Audio.usePermissions();
  const [location, setLocation] = useState(null);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission to access location was denied');
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      setLocation(location);
    })();
  }, []);

  async function startGuarding() {
    try {
      if (permissionResponse.status !== 'granted') {
        console.log('Requesting permission..');
        await requestPermission();
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('Starting recording..');
      const { recording } = await Audio.Recording.createAsync( Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      console.log('Recording started');
      setIsGuarding(true);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }

  async function stopGuarding() {
    console.log('Stopping recording..');
    setRecording(undefined);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    console.log('Recording stopped and stored at', uri);
    setIsGuarding(false);
    analyzeAudio(uri);
  }

  async function analyzeAudio(uri) {
    try {
      const audioData = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const model = genAI.getGenerativeModel({ model: "gemini-pro"});
      const prompt = `Does the following audio contain screaming? Answer with only "yes" or "no".`;
      const audio = {
        inlineData: {
          mimeType: 'audio/m4a',
          data: audioData,
        },
      };

      const result = await model.generateContent([prompt, audio]);
      const response = await result.response;
      const text = response.text();

      if (text.toLowerCase().includes('yes')) {
        Alert.alert('Distress Detected!', 'Sending alerts...');
        sendAlerts(uri);
      } else {
        Alert.alert('No Distress Detected', 'Everything seems to be fine.');
      }
    } catch (error) {
      console.error('Error analyzing audio:', error);
      Alert.alert('Error', 'Could not analyze the audio.');
    }
  }

  async function sendAlerts(uri) {
    // Send to backend
    const formData = new FormData();
    formData.append('audio', {
      uri,
      name: 'audio.m4a',
      type: 'audio/m4a',
    });

    try {
      await axios.post(`${process.env.BACKEND_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      console.log('Audio uploaded to backend.');
    } catch (error) {
      console.error('Error uploading audio:', error);
    }

    // Send Twilio message
    const message = `Emergency! Distress detected at location: https://www.google.com/maps/search/?api=1&query=${location.coords.latitude},${location.coords.longitude}`;
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

    const details = {
        'To': process.env.EMERGENCY_CONTACT_PHONE_NUMBER,
        'From': process.env.TWILIO_PHONE_NUMBER,
        'Body': message,
    };
    var formBody = [];
    for (var property in details) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(details[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    formBody = formBody.join("&");
    try {
        const response = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Authorization': 'Basic ' + btoa(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`)
            },
            body: formBody
        });
        const data = await response.json();
        console.log('Twilio response:', data);
    } catch (error) {
        console.error('Error sending Twilio message:', error);
    }
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1c2a4d', '#2c3e50']}
        style={styles.background}
      />
      <StatusBar style="light" />
      <View style={[styles.guardingIndicator, isGuarding && styles.guardingActive]} />
      <Text style={styles.title}>BlockSafe</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={recording ? stopGuarding : startGuarding}
      >
        <Text style={styles.buttonText}>
          {isGuarding ? 'Stop Guard' : 'Start Guard'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  background: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '100%',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 50,
  },
  button: {
    backgroundColor: '#e74c3c',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  guardingIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 0,
    borderColor: 'red',
  },
  guardingActive: {
    borderWidth: 10,
  },
});