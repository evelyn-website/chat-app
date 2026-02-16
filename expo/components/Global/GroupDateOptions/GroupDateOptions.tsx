import { Text, View } from "react-native";
import React, { useState, useEffect } from "react";
import { DateOptions } from "@/types/types";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useActionSheet } from "@expo/react-native-action-sheet";
import Button from "../Button/Button";

type GroupDateOptionsProps = {
  dateOptions: DateOptions;
  setDateOptions: React.Dispatch<React.SetStateAction<DateOptions>>;
};

type ExpirationOptions = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 14 | "month";

const data: {
  label: string;
  value: ExpirationOptions;
}[] = [
  { label: "1 day", value: 1 },
  { label: "2 days", value: 2 },
  { label: "3 days", value: 3 },
  { label: "4 days", value: 4 },
  { label: "5 days", value: 5 },
  { label: "6 days", value: 6 },
  { label: "1 week", value: 7 },
  { label: "2 weeks", value: 14 },
  { label: "1 month", value: "month" },
];

const GroupDateOptions = ({
  dateOptions,
  setDateOptions,
}: GroupDateOptionsProps) => {
  const { showActionSheetWithOptions } = useActionSheet();

  const [show, setShow] = useState(false);
  const [expirationInterval, setExpirationInterval] =
    useState<ExpirationOptions>(1);
  const formatDate = (date: Date | null) => {
    if (!date) return { datePart: "Not set", timePart: "" };

    const datePart = date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const timePart = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

    return { datePart, timePart };
  };

  const onSelectExpiration = () => {
    const options = [...data.map((option) => option.label), "Cancel"];
    const cancelButtonIndex = options.length - 1;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (selectedIndex: number | undefined) => {
        if (selectedIndex !== undefined && data[selectedIndex]) {
          setExpirationInterval(data[selectedIndex].value);
        }
      },
    );
  };

  const onChange = (_: DateTimePickerEvent, selectedDate: Date | undefined) => {
    const currentDate = selectedDate;
    if (currentDate && expirationInterval !== "month") {
      const expirationDate = new Date(currentDate);
      expirationDate.setDate(
        expirationDate.getDate() + Number(expirationInterval),
      );
      setDateOptions({
        startTime: currentDate,
        endTime: expirationDate,
      });
    } else if (currentDate) {
      const expirationDate = new Date(currentDate);
      expirationDate.setMonth(expirationDate.getMonth() + 1);
      setDateOptions({
        startTime: currentDate,
        endTime: expirationDate,
      });
    }
  };

  useEffect(() => {
    setDateOptions((prevState) => {
      if (prevState.startTime && expirationInterval !== "month") {
        const expirationDate = new Date(prevState.startTime);
        expirationDate.setDate(
          expirationDate.getDate() + Number(expirationInterval),
        );
        return {
          startTime: prevState.startTime,
          endTime: expirationDate,
        };
      } else if (prevState.startTime) {
        const expirationDate = new Date(prevState.startTime);
        expirationDate.setMonth(expirationDate.getMonth() + 1);
        return {
          startTime: prevState.startTime,
          endTime: expirationDate,
        };
      }
      return prevState;
    });
  }, [expirationInterval, setDateOptions]);

  const toggleDatePicker = () => {
    setShow(!show);
  };

  const startFormatted = formatDate(dateOptions?.startTime);
  const endFormatted = formatDate(dateOptions?.endTime);
  const secondaryButtonClassName =
    "bg-white/5 rounded-xl active:bg-white/10";
  const quickOptionButtonClassName = `flex-1 ${secondaryButtonClassName}`;
  const secondaryButtonTextClassName = "text-blue-100 font-medium";

  return (
    <View className="w-full overflow-hidden">
      <View className="mb-4 w-full">
        <View className="flex flex-row mb-2 w-full">
          <Button
            size="base"
            onPress={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);

              setDateOptions({
                startTime: new Date(),
                endTime: tomorrow,
              });
            }}
            text="Today"
            className={`mr-2 ${quickOptionButtonClassName}`}
            textClassName={secondaryButtonTextClassName}
            border={false}
          />
          <Button
            size="base"
            onPress={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);

              const nextDay = new Date();
              nextDay.setDate(nextDay.getDate() + 2);

              setDateOptions({
                startTime: tomorrow,
                endTime: nextDay,
              });
            }}
            text="Tomorrow"
            className={quickOptionButtonClassName}
            textClassName={secondaryButtonTextClassName}
            border={false}
          />
        </View>
        <Button
          size="base"
          onPress={() => {
            const startTime = new Date();
            const endTime = new Date();
            const dayOfWeek = startTime.getDay();
            switch (dayOfWeek) {
              case 0:
                endTime.setDate(endTime.getDate() + 1);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 1:
                startTime.setDate(startTime.getDate() + 4);
                startTime.setHours(18);
                startTime.setMinutes(0);
                startTime.setSeconds(0);
                endTime.setDate(endTime.getDate() + 7);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 2:
                startTime.setDate(startTime.getDate() + 3);
                startTime.setHours(18);
                startTime.setMinutes(0);
                startTime.setSeconds(0);
                endTime.setDate(endTime.getDate() + 6);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 3:
                startTime.setDate(startTime.getDate() + 2);
                startTime.setHours(18);
                startTime.setMinutes(0);
                startTime.setSeconds(0);
                endTime.setDate(endTime.getDate() + 5);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 4:
                startTime.setDate(startTime.getDate() + 1);
                startTime.setHours(18);
                startTime.setMinutes(0);
                startTime.setSeconds(0);
                endTime.setDate(endTime.getDate() + 4);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 5:
                endTime.setDate(endTime.getDate() + 3);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
              case 6:
                endTime.setDate(endTime.getDate() + 2);
                endTime.setHours(9);
                endTime.setMinutes(0);
                endTime.setSeconds(0);
                break;
            }

            setDateOptions({
              startTime: startTime,
              endTime: endTime,
            });
          }}
          text="This weekend"
          className={`${secondaryButtonClassName} w-full`}
          textClassName={secondaryButtonTextClassName}
          border={false}
        />
      </View>
      <Button
        size="base"
        onPress={toggleDatePicker}
        text={show ? "Hide Custom Date" : "Custom Date & Time"}
        className="bg-blue-600 rounded-xl mb-4 w-full"
        textClassName="text-white font-medium"
        border={false}
      />
      <View className="bg-white/5 rounded-xl p-3 mb-2 w-full h-min-[80]">
        <View className="mb-3">
          <Text className="text-xs text-zinc-200 mb-1">Starts</Text>
          <View className="flex flex-row">
            <Text className="text-sm font-medium text-zinc-100">
              {startFormatted.datePart} {startFormatted.timePart}
            </Text>
          </View>
        </View>

        <View>
          <Text className="text-xs text-zinc-200 mb-1">Ends</Text>
          <View className="flex flex-row">
            <Text className="text-sm font-medium text-zinc-100">
              {endFormatted.datePart} {endFormatted.timePart}
            </Text>
          </View>
        </View>
      </View>
      {show && (
        <View className="mt-2 bg-white/10 rounded-xl p-3 w-full">
          <Text className="text-sm font-medium text-zinc-200 mb-2">
            Select Start Date & Time
          </Text>
          <View className="w-full items-center">
            <DateTimePicker
              testID="dateTimePicker"
              value={dateOptions?.startTime ?? new Date()}
              mode={"datetime"}
              onChange={onChange}
              themeVariant="dark"
            />
          </View>
          <Text className="text-sm font-medium text-zinc-200 mb-2 mt-3">
            Set Duration
          </Text>
          <View className="w-full">
            <Button
              text={`${data.find((item) => item?.value === expirationInterval)?.label}`}
              onPress={onSelectExpiration}
              className={secondaryButtonClassName}
              textClassName={secondaryButtonTextClassName}
              border={false}
            />
          </View>
        </View>
      )}
    </View>
  );
};

export default GroupDateOptions;
