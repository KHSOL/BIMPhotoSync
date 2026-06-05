import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Feather } from "@expo/vector-icons";

import { LogoLockup } from "./Branding";
import type { AuthMode, RegisterRole } from "../domain";

type AuthScreenProps = {
  authBusy: boolean;
  authMode: AuthMode;
  companyName: string;
  email: string;
  name: string;
  password: string;
  registerRole: RegisterRole;
  rememberLogin: boolean;
  setAuthMode: (value: AuthMode) => void;
  setCompanyName: (value: string) => void;
  setEmail: (value: string) => void;
  setName: (value: string) => void;
  setPassword: (value: string) => void;
  setRegisterRole: (value: RegisterRole) => void;
  setRememberLogin: (value: boolean) => void;
  submit: () => Promise<void>;
};

type AuthInputProps = {
  icon?: React.ReactNode;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
} & Pick<TextInputProps, "autoCapitalize" | "autoCorrect" | "keyboardType" | "secureTextEntry">;

export function AuthScreen(props: AuthScreenProps) {
  const isLogin = props.authMode === "login";

  return (
    <View style={styles.authLayout}>
      <LogoLockup centered />
      <Text style={styles.loginSubtitle}>현장 사진과 BIM 모델을 연결하여 프로젝트를 더 효율적으로 관리하세요.</Text>
      <View style={styles.loginHeroFrame}>
        <Image source={require("../../assets/login-hero.png")} style={styles.loginHeroImage} resizeMode="contain" />
      </View>

      <View style={styles.authCard}>
        {isLogin ? null : (
          <View style={styles.authTitleBlock}>
            <Text style={styles.authTitle}>회원가입</Text>
            <Text style={styles.authDescription}>현장 사진을 기록할 계정을 생성하세요.</Text>
            <View style={styles.roleRow}>
              <RoleButton label="현장 작업자" active={props.registerRole === "WORKER"} onPress={() => props.setRegisterRole("WORKER")} />
              <RoleButton label="회사 관리자" active={props.registerRole === "COMPANY_ADMIN"} onPress={() => props.setRegisterRole("COMPANY_ADMIN")} />
            </View>
          </View>
        )}

        <AuthInput
          icon={<AuthIcon glyph="mail" />}
          value={props.email}
          onChangeText={props.setEmail}
          placeholder="이메일 주소"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <AuthInput
          icon={<AuthIcon glyph="lock" />}
          value={props.password}
          onChangeText={props.setPassword}
          placeholder="비밀번호"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {isLogin ? null : (
          <>
            <AuthInput value={props.name} onChangeText={props.setName} placeholder="이름" />
            <AuthInput value={props.companyName} onChangeText={props.setCompanyName} placeholder="회사명" />
          </>
        )}

        {isLogin ? (
          <View style={styles.loginOptionRow}>
            <Pressable style={styles.checkRow} onPress={() => props.setRememberLogin(!props.rememberLogin)}>
              <View style={[styles.checkbox, props.rememberLogin && styles.checkboxActive]}>
                {props.rememberLogin ? <Feather name="check" size={20} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.checkText}>로그인 상태 유지</Text>
            </Pressable>
            <Text style={styles.linkText}>비밀번호 찾기</Text>
          </View>
        ) : null}

        <Pressable style={[styles.primaryAction, props.authBusy && styles.disabledButton]} disabled={props.authBusy} onPress={() => void props.submit()}>
          {props.authBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>{isLogin ? "로그인" : "계정 생성"}</Text>}
        </Pressable>

        <View style={styles.authSwitchRow}>
          <Text style={styles.authSwitchText}>{isLogin ? "아이디가 없으신가요?" : "이미 계정이 있으신가요?"}</Text>
          <Pressable onPress={() => props.setAuthMode(isLogin ? "register" : "login")}>
            <Text style={styles.authSwitchLink}>{isLogin ? "회원가입" : "로그인"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AuthIcon({ glyph }: { glyph: "mail" | "lock" }) {
  return <Feather name={glyph} size={28} color="#697386" />;
}

function AuthInput({ icon, placeholder, ...props }: AuthInputProps) {
  return (
    <View style={styles.inputFrame}>
      {icon ? <View style={styles.inputIcon}>{icon}</View> : null}
      <TextInput style={styles.input} placeholder={placeholder} placeholderTextColor="#9AA4B2" {...props} />
    </View>
  );
}

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.roleButton, active && styles.roleButtonActive]} onPress={onPress}>
      <Text style={[styles.roleButtonText, active && styles.roleButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authLayout: { flexGrow: 1, justifyContent: "center", gap: 14, paddingVertical: 8 },
  loginSubtitle: { color: "#667085", fontSize: 17, lineHeight: 27, textAlign: "center", paddingHorizontal: 18 },
  loginHeroFrame: { height: 220, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  loginHeroImage: { width: "92%", height: 250, opacity: 0.98, transform: [{ translateY: -4 }] },
  authCard: { gap: 14 },
  authTitleBlock: { gap: 10 },
  authTitle: { color: "#101828", fontSize: 24, lineHeight: 31, fontWeight: "900", textAlign: "center" },
  authDescription: { color: "#667085", fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  roleRow: { flexDirection: "row", gap: 8 },
  roleButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: "#D6DEE9", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  roleButtonActive: { borderColor: "#2F7DE1", backgroundColor: "#EAF3FF" },
  roleButtonText: { color: "#475569", fontWeight: "900" },
  roleButtonTextActive: { color: "#1D4ED8" },
  inputFrame: { minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  inputIcon: { width: 34, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 48, color: "#101828", fontSize: 17, padding: 0 },
  loginOptionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  checkboxActive: { backgroundColor: "#1669F2", borderColor: "#1669F2" },
  checkText: { color: "#101828", fontSize: 14, fontWeight: "700" },
  linkText: { color: "#667085", fontSize: 14, fontWeight: "800" },
  primaryAction: { minHeight: 62, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#1669F2", shadowColor: "#1669F2", shadowOpacity: 0.24, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  primaryActionText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  authSwitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 2 },
  authSwitchText: { color: "#8A94A6", fontSize: 14, fontWeight: "700" },
  authSwitchLink: { color: "#1669F2", fontSize: 14, fontWeight: "900" },
  disabledButton: { opacity: 0.48 }
});
