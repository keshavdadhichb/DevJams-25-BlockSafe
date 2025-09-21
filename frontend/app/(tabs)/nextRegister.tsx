import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const { width } = Dimensions.get("window");

type FormPage = {
  id: string;
  fields: { label: string; placeholder: string }[];
};

const pages: FormPage[] = [
  {
    id: "contacts",
    fields: [
      { label: "Contact 1 Name", placeholder: "Alice" },
      { label: "Contact 1 Phone", placeholder: "+91 9876543210" },
      { label: "Contact 2 Name", placeholder: "Bob" },
      { label: "Contact 2 Phone", placeholder: "+91 9123456789" },
      { label: "Contact 3 Name", placeholder: "Charlie" },
      { label: "Contact 3 Phone", placeholder: "+91 9988776655" },
    ],
  },
];

export default function RegisterScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [currentPage] = useState(0); // only one page now

  const handleFinish = () => {
    // 👉 handle final navigation here
    // could be router.push("/home") or save data before navigating
    router.push("/home");
  };

  const renderPage = ({ item }: { item: FormPage }) => (
    <View style={[styles.page, { width }]}>
      <Text style={styles.title}>Your Top 3 Contacts</Text>
      <View style={styles.form}>
        {item.fields.map((field, idx) => (
          <View key={idx} style={styles.inputGroup}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput
              style={styles.input}
              placeholder={field.placeholder}
              placeholderTextColor="#aaa"
              keyboardType={field.label.includes("Phone") ? "phone-pad" : "default"}
            />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
      />

      {/* Progress bar + finish button */}
      <View style={styles.footer}>
        <View style={styles.progressContainer}>
          {pages.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, currentPage === i && styles.activeDot]}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.nextButton} onPress={handleFinish}>
          <Ionicons name="checkmark-done-circle" size={48} color="#4CAF50" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0e0e23" },
  page: { flex: 1, padding: 20, justifyContent: "center" },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 20,
    textAlign: "center",
  },
  form: { marginTop: 10 },
  inputGroup: { marginBottom: 15 },
  label: { color: "#aaa", marginBottom: 5 },
  input: {
    backgroundColor: "#1e1e3f",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  progressContainer: { flexDirection: "row", gap: 8 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#555",
  },
  activeDot: {
    backgroundColor: "#7b61ff",
    width: 16,
  },
  nextButton: {
    alignItems: "center",
    justifyContent: "center",
  },
});
