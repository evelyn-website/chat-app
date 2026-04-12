import DateTimePicker from "@react-native-community/datetimepicker";
import { isAxiosError } from "axios";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useAuthUtils } from "../context/AuthUtilsContext";
import Button from "../Global/Button/Button";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const MAX_USERNAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_AGE = 18;

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getAge(birthday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  if (today < new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate())) {
    age--;
  }
  return age;
}

export default function SignupForm() {
  const { signup } = useAuthUtils();

  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUsernameValid = username.trim().length > 0 && username.trim().length <= MAX_USERNAME_LENGTH;
  const isEmailValid = email.trim().length > 0 && EMAIL_REGEX.test(email.trim()) && email.trim().length <= MAX_EMAIL_LENGTH;
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
  const isBirthdayValid = birthday !== null && getAge(birthday) >= MIN_AGE;

  const handleSignup = async () => {
    if (isUsernameValid && isEmailValid && isPasswordValid && isBirthdayValid) {
      setIsLoading(true);
      setError(null);
      try {
        await signup(username.trim(), email.trim(), password, formatDate(birthday!));
      } catch (err) {
        const message =
          isAxiosError(err) && err.response?.data?.message
            ? err.response.data.message
            : "Sign up failed. Please try again.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const maxBirthdayDate = new Date();
  maxBirthdayDate.setFullYear(maxBirthdayDate.getFullYear() - MIN_AGE);

  return (
    <View className="w-full">
      {error && (
        <View className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4">
          <Text className="text-red-400 text-sm">{error}</Text>
        </View>
      )}
      <View className="space-y-4 mb-6">
        <View>
          <Text className="text-sm font-medium text-gray-300 mb-1">Email</Text>
          <TextInput
            autoFocus
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Enter your email"
            placeholderTextColor="#6B7280"
            className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full"
            onChangeText={setEmail}
            value={email}
          />
          {email.length > 0 && !isEmailValid && (
            <Text className="text-amber-500 text-xs mt-1">
              Please enter a valid email address
            </Text>
          )}
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-300 mb-1">
            Username
          </Text>
          <TextInput
            autoCapitalize="none"
            placeholder="Choose a username"
            placeholderTextColor="#6B7280"
            className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full"
            onChangeText={setUsername}
            value={username}
            maxLength={MAX_USERNAME_LENGTH}
          />
          {username.length > 0 && !isUsernameValid && (
            <Text className="text-amber-500 text-xs mt-1">
              Username cannot be blank or exceed {MAX_USERNAME_LENGTH} characters
            </Text>
          )}
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-300 mb-1">
            Password
          </Text>
          <TextInput
            autoCapitalize="none"
            secureTextEntry={true}
            placeholder="Create a password (min 8 characters)"
            placeholderTextColor="#6B7280"
            className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full"
            onChangeText={setPassword}
            value={password}
            maxLength={MAX_PASSWORD_LENGTH}
          />
          {password.length > 0 && !isPasswordValid && (
            <Text className="text-amber-500 text-xs mt-1">
              Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters
            </Text>
          )}
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-300 mb-1">
            Birthday
          </Text>
          {showPicker ? (
            <View className="bg-white/10 rounded-xl p-3 w-full items-center">
              <DateTimePicker
                mode="date"
                value={birthday ?? new Date()}
                maximumDate={maxBirthdayDate}
                themeVariant="dark"
                onChange={(_, date) => {
                  setShowPicker(false);
                  if (date) setBirthday(date);
                }}
              />
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => setShowPicker(true)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 w-full"
              >
                <Text className={birthday ? "text-white" : "text-gray-500"}>
                  {birthday ? formatDate(birthday) : "Select your birthday"}
                </Text>
              </Pressable>
              {birthday !== null && !isBirthdayValid && (
                <Text className="text-amber-500 text-xs mt-1">
                  You must be at least {MIN_AGE} years old to sign up
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      <Button
        onPress={handleSignup}
        text={isLoading ? "Creating Account..." : "Sign Up"}
        size="lg"
        variant="primary"
        className="w-full"
        disabled={isLoading || !isUsernameValid || !isEmailValid || !isPasswordValid || !isBirthdayValid}
      />

      <Text className="text-gray-400 text-xs text-center mt-4">
        By signing up, you agree to our Terms of Service and Privacy Policy
      </Text>
    </View>
  );
}
