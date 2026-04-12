import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const SETTINGS_USE_24H_TIME_KEY = "settings_use_24h_time";

type TimeFormatContextType = {
  use24HourTime: boolean;
  isLoading: boolean;
  setUse24HourTime: (nextValue: boolean) => Promise<void>;
};

const TimeFormatContext = createContext<TimeFormatContextType | undefined>(
  undefined,
);

export const TimeFormatProvider = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const [use24HourTime, setUse24HourTimeState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(SETTINGS_USE_24H_TIME_KEY);
        setUse24HourTimeState(stored === "true");
      } catch (error) {
        console.error("Failed to load 24-hour time preference:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPreference();
  }, []);

  const setUse24HourTime = useCallback(async (nextValue: boolean) => {
    setUse24HourTimeState(nextValue);
    try {
      await AsyncStorage.setItem(
        SETTINGS_USE_24H_TIME_KEY,
        nextValue ? "true" : "false",
      );
    } catch (error) {
      console.error("Failed saving 24-hour time preference:", error);
    }
  }, []);

  return (
    <TimeFormatContext.Provider
      value={{ use24HourTime, isLoading, setUse24HourTime }}
    >
      {children}
    </TimeFormatContext.Provider>
  );
};

export const useTimeFormat = () => {
  const context = useContext(TimeFormatContext);
  if (!context) {
    throw new Error("useTimeFormat must be used within a TimeFormatProvider");
  }
  return context;
};
