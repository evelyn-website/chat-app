import { Store } from "@/store/Store";
import { User } from "@/types/types";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import http from "@/util/custom-axios";
import * as encryptionService from "@/services/encryptionService";
import { CanceledError } from "axios";
interface DeviceKey {
  deviceId: string;
  publicKey: Uint8Array;
}

type RelevantDeviceKeysMap = Record<string, DeviceKey[]>;
interface ServerDeviceKeyInfo {
  device_identifier: string;
  public_key: string;
}

interface ServerUserWithDeviceKeys {
  user_id: string;
  device_keys: ServerDeviceKeyInfo[];
}

type Action =
  | { type: "SET_USER"; payload: User | undefined }
  | { type: "SET_DEVICE_ID"; payload: string | undefined }
  | { type: "TRIGGER_GROUPS_REFRESH" }
  | { type: "TRIGGER_USERS_REFRESH" }
  | { type: "SET_RELEVANT_DEVICE_KEYS_LOADING"; payload: boolean }
  | {
      type: "SET_RELEVANT_DEVICE_KEYS_SUCCESS";
      payload: RelevantDeviceKeysMap;
    }
  | { type: "SET_RELEVANT_DEVICE_KEYS_ERROR"; payload: string | null };

interface State {
  user: User | undefined;
  deviceId: string | undefined;
  groupsRefreshKey: number;
  usersRefreshKey: number;
  relevantDeviceKeys: RelevantDeviceKeysMap;
  deviceKeysLoading: boolean;
  deviceKeysError: string | null;
}

interface GlobalStoreContextType extends State {
  store: Store;
  setUser: (user: User | undefined) => void;
  setDeviceId: (deviceId: string | undefined) => void;
  refreshGroups: () => void;
  refreshUsers: () => void;
  loadRelevantDeviceKeys: () => Promise<void>;
  getDeviceKeysForUser: (userId: string) => Promise<DeviceKey[] | undefined>;
}

const initialState: State = {
  user: undefined,
  deviceId: undefined,
  groupsRefreshKey: 0,
  usersRefreshKey: 0,
  relevantDeviceKeys: {},
  deviceKeysLoading: false,
  deviceKeysError: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "SET_USER":
      return { ...state, user: action.payload };
    case "SET_DEVICE_ID":
      return { ...state, deviceId: action.payload };
    case "TRIGGER_GROUPS_REFRESH":
      return { ...state, groupsRefreshKey: state.groupsRefreshKey + 1 };
    case "TRIGGER_USERS_REFRESH":
      return { ...state, usersRefreshKey: state.usersRefreshKey + 1 };
    case "SET_RELEVANT_DEVICE_KEYS_LOADING":
      return {
        ...state,
        deviceKeysLoading: action.payload,
        deviceKeysError: null,
      };
    case "SET_RELEVANT_DEVICE_KEYS_SUCCESS":
      return {
        ...state,
        relevantDeviceKeys: action.payload,
        deviceKeysLoading: false,
        deviceKeysError: null,
      };
    case "SET_RELEVANT_DEVICE_KEYS_ERROR":
      return {
        ...state,
        deviceKeysLoading: false,
        deviceKeysError: action.payload,
      };
    default:
      return state;
  }
};

const GlobalStoreContext = createContext<GlobalStoreContextType | undefined>(
  undefined
);

export const GlobalStoreProvider = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const [state, dispatch] = useReducer(reducer, initialState);

  const store = useMemo(() => new Store(), []);

  useEffect(() => {
    return () => {
      store.close();
    };
  }, [store]);

  const setUser = useCallback((user: User | undefined) => {
    dispatch({ type: "SET_USER", payload: user });
  }, []);

  const setDeviceId = useCallback((deviceId: string | undefined) => {
    dispatch({ type: "SET_DEVICE_ID", payload: deviceId });
  }, []);

  const refreshGroups = useCallback(() => {
    dispatch({ type: "TRIGGER_GROUPS_REFRESH" });
  }, []);

  const refreshUsers = useCallback(() => {
    dispatch({ type: "TRIGGER_USERS_REFRESH" });
  }, []);

  const loadRelevantDeviceKeys = useCallback(async () => {
    if (!state.user) {
      console.warn("loadRelevantDeviceKeys: User not authenticated. Skipping.");
      return;
    }
    dispatch({ type: "SET_RELEVANT_DEVICE_KEYS_LOADING", payload: true });
    try {
      const response = await http.get<ServerUserWithDeviceKeys[]>(
        `${process.env.EXPO_PUBLIC_HOST}/api/users/device-keys`
      );
      const serverData = response.data;

      const processedKeys: RelevantDeviceKeysMap = {};

      for (const userWithKeys of serverData) {
        processedKeys[userWithKeys.user_id] = userWithKeys.device_keys.map(
          (keyInfo) => ({
            deviceId: keyInfo.device_identifier,
            publicKey: encryptionService.base64ToUint8Array(keyInfo.public_key),
          })
        );
      }

      dispatch({
        type: "SET_RELEVANT_DEVICE_KEYS_SUCCESS",
        payload: processedKeys,
      });
    } catch (error) {
      if (error instanceof CanceledError) {
        console.log("loadRelevantDeviceKeys: Fetch operation was canceled.");
        dispatch({ type: "SET_RELEVANT_DEVICE_KEYS_LOADING", payload: false });
      } else {
        console.error("Failed to load relevant device keys:", error);
        dispatch({
          type: "SET_RELEVANT_DEVICE_KEYS_ERROR",
          payload: "Failed to load device keys.",
        });
      }
    }
  }, [state.user]);

  const getDeviceKeysForUser = useCallback(
    async (userId: string): Promise<DeviceKey[] | undefined> => {
      return state.relevantDeviceKeys[userId];
    },
    [state.relevantDeviceKeys]
  );

  const value = useMemo(
    () => ({
      ...state,
      setUser,
      setDeviceId,
      refreshGroups,
      refreshUsers,
      store,
      loadRelevantDeviceKeys,
      getDeviceKeysForUser,
    }),
    [
      state,
      setUser,
      setDeviceId,
      refreshGroups,
      refreshUsers,
      store,
      loadRelevantDeviceKeys,
      getDeviceKeysForUser,
    ]
  );

  return (
    <GlobalStoreContext.Provider value={value}>
      {children}
    </GlobalStoreContext.Provider>
  );
};

export const useGlobalStore = () => {
  const context = useContext(GlobalStoreContext);
  if (!context) {
    throw new Error("useGlobalStore must be used within a GlobalStoreProvider");
  }
  return context;
};
