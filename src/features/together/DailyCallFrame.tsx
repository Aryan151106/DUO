import React from 'react';

export interface DailyCallFrameProps {
  roomUrl?: string;
  token?: string;
  userName?: string;
  onLeave?: () => void;
  onError?: (err: any) => void;
  onSwitchToBuiltinCall?: () => void;
  onUpdateRoomUrl?: (newUrl: string) => void;
  customControls?: React.ReactNode;
  onScreenShareStarted?: () => void;
  onScreenShareStopped?: () => void;
  onBeforeScreenShare?: () => Promise<boolean>;
  screenShareNotice?: string | null;
}

/**
 * @deprecated Daily.co has been migrated to LiveKit Cloud.
 * Use LiveKitMediaRoom from './LiveKitMediaRoom' instead.
 */
export const DailyCallFrame: React.FC<DailyCallFrameProps> = ({ onLeave }) => {
  return (
    <div className="w-full p-8 text-center bg-[var(--surface-2)] rounded-3xl border-2 border-[var(--border)] text-[var(--text)]">
      <p className="font-chunky text-sm font-bold mb-2">Media Engine Migrated</p>
      <p className="font-ui text-xs text-[var(--text-muted)] mb-4">
        Study Space and Movie Night have migrated to LiveKit Cloud for superior audio, video, and screen sharing.
      </p>
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white font-bold text-xs cursor-pointer"
        >
          Return to Room
        </button>
      )}
    </div>
  );
};
