import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useAuthUtils } from "../context/AuthUtilsContext";
import Button from "../Global/Button/Button";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const MAX_USERNAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupForm() {
  const { signup } = useAuthUtils();

  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const isUsernameValid = username.trim().length > 0 && username.trim().length <= MAX_USERNAME_LENGTH;
  const isEmailValid = email.trim().length > 0 && EMAIL_REGEX.test(email.trim()) && email.trim().length <= MAX_EMAIL_LENGTH;
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;

  const handleSignup = async () => {
    if (isUsernameValid && isEmailValid && isPasswordValid) {
      setIsLoading(true);
      try {
        await signup(username.trim(), email.trim(), password);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <View className="w-full">
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
            onSubmitEditing={handleSignup}
            maxLength={MAX_PASSWORD_LENGTH}
          />
          {password.length > 0 && !isPasswordValid && (
            <Text className="text-amber-500 text-xs mt-1">
              Password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters
            </Text>
          )}
        </View>
      </View>

      <Button
        onPress={handleSignup}
        text={isLoading ? "Creating Account..." : "Sign Up"}
        size="lg"
        variant="primary"
        className="w-full"
        disabled={isLoading || !isUsernameValid || !isEmailValid || !isPasswordValid}
      />

      <Text className="text-gray-400 text-xs text-center mt-4">
        By signing up, you agree to our Terms of Service and Privacy Policy
      </Text>
    </View>
  );
}
