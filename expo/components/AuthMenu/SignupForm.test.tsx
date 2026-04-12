import React, { act } from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import SignupForm from "./SignupForm";

const mockSignup = jest.fn();

jest.mock("../context/AuthUtilsContext", () => ({
  useAuthUtils: () => ({ signup: mockSignup }),
}));

// Capture onChange so tests can invoke it with a specific date
let simulateDatePicked: ((date: Date) => void) | null = null;

jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return ({ onChange }: { onChange: (e: unknown, date: Date) => void }) => {
    simulateDatePicked = (date: Date) => onChange({}, date);
    return <View testID="mock-date-picker" />;
  };
});

jest.mock("../Global/Button/Button", () => {
  const { Pressable, Text } = require("react-native");
  return ({
    onPress,
    text,
    disabled,
  }: {
    onPress: () => void;
    text: string;
    disabled?: boolean;
  }) => (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityState={{ disabled: !!disabled }}
      testID="submit-button"
    >
      <Text>{text}</Text>
    </Pressable>
  );
});

jest.mock("axios", () => ({
  isAxiosError: jest.fn(),
}));

function birthdayYearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

function fillValidForm(
  getByPlaceholderText: ReturnType<typeof render>["getByPlaceholderText"],
) {
  fireEvent.changeText(
    getByPlaceholderText("Enter your email"),
    "user@example.com",
  );
  fireEvent.changeText(
    getByPlaceholderText("Choose a username"),
    "testuser",
  );
  fireEvent.changeText(
    getByPlaceholderText("Create a password (min 8 characters)"),
    "password123",
  );
}

function pickBirthday(birthday: Date, getByText: ReturnType<typeof render>["getByText"]) {
  fireEvent.press(getByText("Select your birthday"));
  act(() => simulateDatePicked!(birthday));
}

describe("SignupForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    simulateDatePicked = null;
  });

  it("renders all fields and the sign up button", () => {
    const { getByPlaceholderText, getByText } = render(<SignupForm />);

    expect(getByPlaceholderText("Enter your email")).toBeTruthy();
    expect(getByPlaceholderText("Choose a username")).toBeTruthy();
    expect(getByPlaceholderText("Create a password (min 8 characters)")).toBeTruthy();
    expect(getByText("Select your birthday")).toBeTruthy();
    expect(getByText("Sign Up")).toBeTruthy();
  });

  it("submit button is disabled when the form is empty", () => {
    const { getByTestId } = render(<SignupForm />);
    expect(getByTestId("submit-button").props.accessibilityState.disabled).toBe(true);
  });

  it("submit button is disabled when birthday is missing", () => {
    const { getByPlaceholderText, getByTestId } = render(<SignupForm />);
    fillValidForm(getByPlaceholderText);
    expect(getByTestId("submit-button").props.accessibilityState.disabled).toBe(true);
  });

  describe("birthday picker", () => {
    it("shows the picker when the birthday field is pressed", () => {
      const { getByText, queryByTestId } = render(<SignupForm />);

      expect(queryByTestId("mock-date-picker")).toBeNull();
      fireEvent.press(getByText("Select your birthday"));
      expect(queryByTestId("mock-date-picker")).toBeTruthy();
    });

    it("hides the picker and shows the selected date after selection", () => {
      const { getByText, queryByTestId, queryByText } = render(<SignupForm />);
      const birthday = birthdayYearsAgo(20);

      fireEvent.press(getByText("Select your birthday"));
      act(() => simulateDatePicked!(birthday));

      expect(queryByTestId("mock-date-picker")).toBeNull();

      const yyyy = birthday.getFullYear();
      const mm = String(birthday.getMonth() + 1).padStart(2, "0");
      const dd = String(birthday.getDate()).padStart(2, "0");
      expect(queryByText(`${yyyy}-${mm}-${dd}`)).toBeTruthy();
    });

    it("shows an under-18 error when the user is younger than 18", () => {
      const { getByText, queryByText } = render(<SignupForm />);
      pickBirthday(birthdayYearsAgo(16), getByText);
      expect(queryByText("You must be at least 18 years old to sign up")).toBeTruthy();
    });

    it("does not show an under-18 error when the user is exactly 18", () => {
      const { getByText, queryByText } = render(<SignupForm />);
      pickBirthday(birthdayYearsAgo(18), getByText);
      expect(queryByText("You must be at least 18 years old to sign up")).toBeNull();
    });

    it("submit button is disabled when user is under 18", () => {
      const { getByPlaceholderText, getByText, getByTestId } = render(<SignupForm />);
      fillValidForm(getByPlaceholderText);
      pickBirthday(birthdayYearsAgo(16), getByText);
      expect(getByTestId("submit-button").props.accessibilityState.disabled).toBe(true);
    });

    it("submit button is enabled when all fields are valid and user is 18+", () => {
      const { getByPlaceholderText, getByText, getByTestId } = render(<SignupForm />);
      fillValidForm(getByPlaceholderText);
      pickBirthday(birthdayYearsAgo(20), getByText);
      expect(getByTestId("submit-button").props.accessibilityState.disabled).toBe(false);
    });
  });

  describe("form submission", () => {
    function fillAndSubmit(
      utils: ReturnType<typeof render>,
      birthday: Date = birthdayYearsAgo(20),
    ) {
      fillValidForm(utils.getByPlaceholderText);
      pickBirthday(birthday, utils.getByText);
      fireEvent.press(utils.getByTestId("submit-button"));
    }

    it("calls signup with the correct arguments", async () => {
      mockSignup.mockResolvedValue(undefined);
      const utils = render(<SignupForm />);
      const birthday = birthdayYearsAgo(20);
      fillAndSubmit(utils, birthday);

      const yyyy = birthday.getFullYear();
      const mm = String(birthday.getMonth() + 1).padStart(2, "0");
      const dd = String(birthday.getDate()).padStart(2, "0");

      await waitFor(() => {
        expect(mockSignup).toHaveBeenCalledWith(
          "testuser",
          "user@example.com",
          "password123",
          `${yyyy}-${mm}-${dd}`,
        );
      });
    });

    it("shows a generic error banner when signup throws without a server message", async () => {
      const { isAxiosError } = require("axios");
      isAxiosError.mockReturnValue(false);
      mockSignup.mockRejectedValue(new Error("Network error"));

      const utils = render(<SignupForm />);
      fillAndSubmit(utils);

      await waitFor(() => {
        expect(utils.queryByText("Sign up failed. Please try again.")).toBeTruthy();
      });
    });

    it("shows the server error message when the axios response contains one", async () => {
      const { isAxiosError } = require("axios");
      isAxiosError.mockReturnValue(true);
      mockSignup.mockRejectedValue({
        response: { data: { message: "You must be at least 18 years old to sign up" } },
      });

      const utils = render(<SignupForm />);
      fillAndSubmit(utils);

      await waitFor(() => {
        expect(
          utils.queryByText("You must be at least 18 years old to sign up"),
        ).toBeTruthy();
      });
    });

    it("clears the error banner on a subsequent submission attempt", async () => {
      const { isAxiosError } = require("axios");
      isAxiosError.mockReturnValue(false);
      mockSignup
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(undefined);

      const utils = render(<SignupForm />);
      fillAndSubmit(utils);

      await waitFor(() => {
        expect(utils.queryByText("Sign up failed. Please try again.")).toBeTruthy();
      });

      fireEvent.press(utils.getByTestId("submit-button"));

      await waitFor(() => {
        expect(utils.queryByText("Sign up failed. Please try again.")).toBeNull();
      });
    });
  });
});
