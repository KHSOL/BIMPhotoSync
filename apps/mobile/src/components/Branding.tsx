import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export function LogoLockup({ centered }: { centered?: boolean }) {
  return (
    <View style={[styles.logoLockup, centered && styles.logoLockupCentered]}>
      <LogoMarkImage />
      <Text style={styles.logoText}>
        BIM <Text style={styles.logoTextBlue}>PhotoSync</Text>
      </Text>
    </View>
  );
}

export function LogoMarkImage({ small }: { small?: boolean }) {
  return <Image source={require("../../assets/app-logo-mark.png")} style={small ? styles.logoMarkSmallImage : styles.logoMarkImage} resizeMode="contain" />;
}

const styles = StyleSheet.create({
  logoLockup: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoLockupCentered: { alignSelf: "center" },
  logoMarkImage: { width: 46, height: 46 },
  logoMarkSmallImage: { width: 38, height: 38 },
  logoText: { color: "#13233A", fontSize: 29, fontWeight: "900", letterSpacing: 0 },
  logoTextBlue: { color: "#1D6FEA" }
});
