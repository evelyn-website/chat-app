import axios from "axios";
import { get, clear } from "./custom-store";
import { jwtDecode } from "jwt-decode";

const http = axios.create();

let logoutCallback = null;

export function setLogoutCallback(fn) {
  logoutCallback = fn;
}

function isTokenExpired(token) {
  if (!token) {
    return true;
  }

  try {
    const decodedToken = jwtDecode(token);
    const expirationTime = decodedToken.exp;
    const currentTime = Math.floor(Date.now() / 1000);

    return expirationTime <= currentTime;
  } catch (error) {
    console.error("Error decoding token:", error);
    return true;
  }
}

http.interceptors.request.use(async (config) => {
  const controller = new AbortController();
  const token = await get("jwt");

  if (token) {
    if (isTokenExpired(token)) {
      console.log("JWT is expired on client-side. Aborting request.");
      await clear("jwt");
      controller.abort();
    } else {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  } else {
    console.log("No JWT found. Aborting request.");
    controller.abort();
  }

  return {
    ...config,
    signal: controller.signal,
  };
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && logoutCallback) {
      try {
        logoutCallback();
      } catch (callbackError) {
        console.error("Error in logout callback:", callbackError);
      }
    }
    return Promise.reject(error);
  },
);

export default http;
