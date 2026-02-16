import { View } from "react-native";
import React from "react";
import { useWebSocket } from "./context/WebSocketContext";
import { useMessageStore } from "./context/MessageStoreContext";
import Button from "./Global/Button/Button";
import { useGlobalStore } from "./context/GlobalStoreContext";

const ConnectionTesting = () => {
  const { establishConnection, disconnect } = useWebSocket();
  const { loadHistoricalMessages } = useMessageStore();
  const { store } = useGlobalStore();
  return (
    <View className="h-screen flex items-center justify-center">
      <Button text={"Connect"} onPress={establishConnection} size={"xl"} />
      <Button text={"Disconnect"} onPress={disconnect} size={"xl"} />
      <Button
        text={"Load messages"}
        onPress={loadHistoricalMessages}
        size={"xl"}
        className="min-w-[280]"
      />
      <Button
        text={"Drop db"}
        onPress={() => {
          store.resetDatabase();
        }}
      />
    </View>
  );
};

export default ConnectionTesting;
