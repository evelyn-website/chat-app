import { View, StyleSheet } from "react-native";
import ConnectionTesting from "@/components/ConnectionTesting";

export default function DevScreen() {
  return (
    <View style={styles.container}>
      <ConnectionTesting />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
