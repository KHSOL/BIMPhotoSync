import React, { useMemo, useState } from "react";
import { Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Room = {
  id: string;
  room_name: string;
  room_number?: string;
  level_name?: string;
};

export default function App() {
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [meta, setMeta] = useState({
    work_surface: "FLOOR",
    trade: "WATERPROOF",
    work_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    description: ""
  });

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);

  async function loadRooms() {
    const res = await fetch(`${API_BASE}/projects/${projectId}/rooms`, { headers: authHeaders(token) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Room 조회 실패");
    setRooms(json.data);
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });
    if (!result.canceled) setImage(result.assets[0]);
  }

  async function upload() {
    if (!token || !projectId || !roomId || !image) {
      Alert.alert("필수값 확인", "토큰, 프로젝트, Room, 사진을 모두 입력하세요.");
      return;
    }
    const mime = image.mimeType ?? "image/jpeg";
    const fileResponse = await fetch(image.uri);
    const blob = await fileResponse.blob();
    const presign = await fetch(`${API_BASE}/uploads/photos/presign`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, mime_type: mime, file_size: blob.size })
    }).then((res) => res.json());

    await fetch(presign.data.presigned_url, { method: "PUT", headers: { "Content-Type": mime }, body: blob });

    const commitRes = await fetch(`${API_BASE}/photos`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        room_id: roomId,
        upload_id: presign.data.upload_id,
        ...meta
      })
    });
    const commit = await commitRes.json();
    if (!commitRes.ok) throw new Error(commit.error?.message ?? "업로드 실패");
    Alert.alert("업로드 완료", "사진이 Room에 연결되고 AI 분석 큐에 등록되었습니다.");
    setImage(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.logo}>BIM Photo Sync</Text>
        <Text style={styles.title}>현장 사진 업로드</Text>

        <Section title="연결">
          <Input label="JWT Token" value={token} onChangeText={setToken} secureTextEntry />
          <Input label="Project ID" value={projectId} onChangeText={setProjectId} />
          <Pressable style={styles.secondaryButton} onPress={() => loadRooms().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.secondaryButtonText}>Room 목록 불러오기</Text>
          </Pressable>
        </Section>

        <Section title="Room">
          <View style={styles.roomGrid}>
            {rooms.map((room) => (
              <Pressable key={room.id} style={[styles.roomChip, roomId === room.id && styles.roomChipActive]} onPress={() => setRoomId(room.id)}>
                <Text style={[styles.roomText, roomId === room.id && styles.roomTextActive]}>
                  {room.level_name ?? "-"} / {room.room_number ?? ""} {room.room_name}
                </Text>
              </Pressable>
            ))}
          </View>
          {selectedRoom ? <Text style={styles.caption}>선택됨: {selectedRoom.room_name}</Text> : null}
        </Section>

        <Section title="사진">
          <Pressable style={styles.primaryButton} onPress={pickImage}>
            <Text style={styles.primaryButtonText}>{image ? "사진 다시 선택" : "사진 선택"}</Text>
          </Pressable>
          {image ? <Image source={{ uri: image.uri }} style={styles.preview} /> : null}
        </Section>

        <Section title="메타데이터">
          <Input label="공사면" value={meta.work_surface} onChangeText={(work_surface) => setMeta({ ...meta, work_surface })} />
          <Input label="공종" value={meta.trade} onChangeText={(trade) => setMeta({ ...meta, trade })} />
          <Input label="작업일" value={meta.work_date} onChangeText={(work_date) => setMeta({ ...meta, work_date })} />
          <Input label="작업자" value={meta.worker_name} onChangeText={(worker_name) => setMeta({ ...meta, worker_name })} />
          <Input label="설명" value={meta.description} onChangeText={(description) => setMeta({ ...meta, description })} multiline />
        </Section>

        <Pressable style={styles.primaryButton} onPress={() => upload().catch((err) => Alert.alert("오류", err.message))}>
          <Text style={styles.primaryButtonText}>업로드</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Input(props: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; secureTextEntry?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.textarea]} placeholder={props.label} {...props} />
    </View>
  );
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  container: { padding: 16, gap: 12 },
  logo: { fontSize: 14, color: "#2563EB", fontWeight: "700" },
  title: { fontSize: 24, lineHeight: 32, color: "#0F172A", fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 16, lineHeight: 24, color: "#0F172A", fontWeight: "600" },
  field: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, color: "#334155" },
  input: { minHeight: 44, borderColor: "#CBD5E1", borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, color: "#0F172A" },
  textarea: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: "#2563EB", borderRadius: 6, paddingHorizontal: 16 },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryButton: { minHeight: 40, alignItems: "center", justifyContent: "center", borderColor: "#2563EB", borderWidth: 1, borderRadius: 6 },
  secondaryButtonText: { color: "#2563EB", fontWeight: "600" },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roomChip: { borderColor: "#CBD5E1", borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  roomChipActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  roomText: { color: "#334155", fontSize: 13 },
  roomTextActive: { color: "#2563EB", fontWeight: "700" },
  caption: { color: "#64748B", fontSize: 11 },
  preview: { width: "100%", height: 220, borderRadius: 8, backgroundColor: "#E2E8F0" }
});

