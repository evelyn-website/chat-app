import { View } from "react-native";
import { useAuthUtils } from "@/components/context/AuthUtilsContext";
import Button from "@/components/Global/Button/Button";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SettingsScreen() {
  const { logout } = useAuthUtils();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 bg-gray-900 items-center justify-center"
      style={{ paddingTop: insets.top }}
    >
      <Button text={"Log out"} onPress={logout} size={"xl"} />
    </View>
  );
}
