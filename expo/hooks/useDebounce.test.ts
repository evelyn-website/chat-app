import { renderHook, act } from "@testing-library/react-native";
import { useDebounce } from "./useDebounce";

describe("useDebounce", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 500));
    expect(result.current).toBe("hello");
  });

  it("does not update before the delay has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 500),
      { initialProps: { value: "initial" } },
    );

    rerender({ value: "updated" });
    act(() => { jest.advanceTimersByTime(499); });
    expect(result.current).toBe("initial");
  });

  it("updates after the delay has elapsed", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 500),
      { initialProps: { value: "initial" } },
    );

    rerender({ value: "updated" });
    act(() => { jest.advanceTimersByTime(500); });
    expect(result.current).toBe("updated");
  });

  it("resets the timer when value changes before delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 500),
      { initialProps: { value: "initial" } },
    );

    rerender({ value: "first" });
    act(() => { jest.advanceTimersByTime(300); });
    rerender({ value: "second" });
    act(() => { jest.advanceTimersByTime(300); });
    // 300ms since last change — not yet at 500ms
    expect(result.current).toBe("initial");

    act(() => { jest.advanceTimersByTime(200); });
    expect(result.current).toBe("second");
  });

  it("works with non-string types", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebounce(value, 300),
      { initialProps: { value: 1 } },
    );

    rerender({ value: 42 });
    act(() => { jest.advanceTimersByTime(300); });
    expect(result.current).toBe(42);
  });
});
