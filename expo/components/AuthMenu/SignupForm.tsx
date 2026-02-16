import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useAuthUtils } from "../context/AuthUtilsContext";
import Button from "../Global/Button/Button";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupForm() {
  const { signup } = useAuthUtils();

  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const isUsernameValid = username.trim().length > 0;
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH;

  const handleSignup = async () => {
    if (isUsernameValid && email.trim() && isPasswordValid) {
      setIsLoading(true);
      try {
        await signup(username, email, password);
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
          />
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
          />
          {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
            <Text className="text-amber-500 text-xs mt-1">
              Password must be at least {MIN_PASSWORD_LENGTH} characters
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
        disabled={isLoading || !isUsernameValid || !email.trim() || !isPasswordValid}
      />

      <Text className="text-gray-400 text-xs text-center mt-4">
        By signing up, you agree to our Terms of Service and Privacy Policy
      </Text>
    </View>
  );
}
