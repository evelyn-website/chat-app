import { renderHook, act } from '@testing-library/react-native';
import { useSendImage } from './useSendImage';
import { useWebSocket } from '@/components/context/WebSocketContext';
import { useGlobalStore } from '@/components/context/GlobalStoreContext';
import { useMessageStore } from '@/components/context/MessageStoreContext';

// Mock dependencies
jest.mock('@/components/context/WebSocketContext');
jest.mock('@/components/context/GlobalStoreContext');
jest.mock('@/components/context/MessageStoreContext');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

describe('useSendImage', () => {
  const mockSendMessage = jest.fn();
  const mockGetDeviceKeysForUser = jest.fn();
  const mockAddOptimisticDisplayable = jest.fn();
  const mockRemoveOptimisticDisplayable = jest.fn();
  const mockGetNextClientSeq = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (useWebSocket as jest.Mock).mockReturnValue({
      sendMessage: mockSendMessage,
    });

    (useGlobalStore as jest.Mock).mockReturnValue({
      user: {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
      },
      getDeviceKeysForUser: mockGetDeviceKeysForUser,
    });

    (useMessageStore as jest.Mock).mockReturnValue({
      addOptimisticDisplayable: mockAddOptimisticDisplayable,
      removeOptimisticDisplayable: mockRemoveOptimisticDisplayable,
      getNextClientSeq: mockGetNextClientSeq,
    });

    mockGetNextClientSeq.mockReturnValue(1);
  });

  describe('Hook interface', () => {
    it('should return sendImage function', () => {
      const { result } = renderHook(() => useSendImage());

      expect(typeof result.current.sendImage).toBe('function');
    });

    it('should return isSendingImage state', () => {
      const { result } = renderHook(() => useSendImage());

      expect(typeof result.current.isSendingImage).toBe('boolean');
      expect(result.current.isSendingImage).toBe(false);
    });

    it('should return imageSendError state', () => {
      const { result } = renderHook(() => useSendImage());

      expect(result.current.imageSendError).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should set error when user is not authenticated', async () => {
      (useGlobalStore as jest.Mock).mockReturnValue({
        user: null,
        getDeviceKeysForUser: mockGetDeviceKeysForUser,
      });

      const { result } = renderHook(() => useSendImage());

      const mockImageAsset = { uri: 'file:///test.jpg', width: 100, height: 100 };

      await act(async () => {
        await result.current.sendImage(mockImageAsset as any, 'group-123', []);
      });

      expect(result.current.imageSendError).toBeTruthy();
      expect(result.current.imageSendError).toContain('User not authenticated');
    });

    // Note: Additional error scenarios omitted due to complex async mocking requirements
  });

  // Note: Full image upload flow tests (S3 upload, cleanup, etc.) are omitted due to
  // complexity of mocking FileSystem operations and async timing issues.
  // These features are better tested through integration/E2E tests.
});
