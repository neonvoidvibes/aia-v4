"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, StopCircle, Download, Bookmark, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type GlobalRecordingStatus = {
  type: 'transcript' | 'recording' | null;
  isRecording: boolean;
  isPaused: boolean;
  time: number;
  sessionId: string | null;
};

interface RecordViewProps {
  agentName: string | null;
  globalRecordingStatus: GlobalRecordingStatus;
  setGlobalRecordingStatus: React.Dispatch<React.SetStateAction<GlobalRecordingStatus>>;
  isTranscriptRecordingActive: boolean;
}

interface FinishedRecording {
  s3Key: string;
  filename: string;
  agentName: string;
  timestamp: string;
}

const RecordView: React.FC<RecordViewProps> = ({
  agentName,
  globalRecordingStatus,
  setGlobalRecordingStatus,
  isTranscriptRecordingActive,
}) => {
  const [finishedRecordings, setFinishedRecordings] = useState<FinishedRecording[]>([]);
  const [isEmbedding, setIsEmbedding] = useState<Record<string, boolean>>({});
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (agentName) {
      const storedRecordings = localStorage.getItem(`finishedRecordings_${agentName}`);
      if (storedRecordings) {
        setFinishedRecordings(JSON.parse(storedRecordings));
      }
    }
  }, [agentName]);

  const saveRecordingsToLocalStorage = (recordings: FinishedRecording[]) => {
    if (agentName) {
      localStorage.setItem(`finishedRecordings_${agentName}`, JSON.stringify(recordings));
    }
  };

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setGlobalRecordingStatus(prev => ({ ...prev, time: prev.time + 1 }));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    if (!agentName) {
      toast.error("Agent not selected. Cannot start recording.");
      return;
    }
    if (isTranscriptRecordingActive) {
        toast.error("A chat transcript is already being recorded. Please stop it first.");
        return;
    }

    try {
      const response = await fetch('/api/audio-recording-proxy?action=start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, transcriptionLanguage: 'any' }),
      });
      const data = await response.json();
      if (response.ok) {
        setGlobalRecordingStatus({
          type: 'recording',
          isRecording: true,
          isPaused: false,
          time: 0,
          sessionId: data.session_id,
        });
        startTimer();
        toast.success("Recording started.");
      } else {
        throw new Error(data.message || "Failed to start recording.");
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error((error as Error).message);
    }
  };

  const handleStopRecording = async () => {
    if (!globalRecordingStatus.sessionId) return;

    stopTimer();
    try {
      const response = await fetch('/api/audio-recording-proxy?action=stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: globalRecordingStatus.sessionId }),
      });
      const data = await response.json();
      if (response.ok) {
        const newRecording: FinishedRecording = {
          s3Key: data.s3Key,
          filename: data.s3Key.split('/').pop(),
          agentName: agentName!,
          timestamp: new Date().toISOString(),
        };
        const updatedRecordings = [newRecording, ...finishedRecordings];
        setFinishedRecordings(updatedRecordings);
        saveRecordingsToLocalStorage(updatedRecordings);
        toast.success("Recording stopped and saved.");
      } else {
        throw new Error(data.message || "Failed to stop recording.");
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
      toast.error((error as Error).message);
    } finally {
        setGlobalRecordingStatus({ type: null, isRecording: false, isPaused: false, time: 0, sessionId: null });
    }
  };

  const handleEmbedRecording = async (s3Key: string) => {
    if (!agentName) return;
    setIsEmbedding(prev => ({ ...prev, [s3Key]: true }));
    try {
      const response = await fetch('/api/recordings/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key, agentName }),
      });
      const data = await response.json();
      if (response.ok) {
        toast.success("Recording successfully embedded.");
      } else {
        throw new Error(data.error || "Failed to embed recording.");
      }
    } catch (error) {
      console.error("Error embedding recording:", error);
      toast.error((error as Error).message);
    } finally {
      setIsEmbedding(prev => ({ ...prev, [s3Key]: false }));
    }
  };

  const handleDownloadRecording = (s3Key: string, filename: string) => {
    const downloadUrl = `/api/s3-proxy/download?s3Key=${encodeURIComponent(s3Key)}&filename=${encodeURIComponent(filename)}`;
    window.open(downloadUrl, '_blank');
  };

  const isRecording = globalRecordingStatus.type === 'recording' && globalRecordingStatus.isRecording;

  return (
    <div className="flex flex-col h-full p-4 space-y-4">
      <div className="flex-shrink-0 flex flex-col items-center justify-center space-y-4 py-8 bg-card rounded-lg">
        <div className="flex items-center space-x-4">
          <Button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            disabled={isTranscriptRecordingActive}
            className="w-24 h-24 rounded-full"
            variant={isRecording ? "destructive" : "default"}
          >
            {isRecording ? <StopCircle className="w-12 h-12" /> : <Play className="w-12 h-12" />}
          </Button>
        </div>
        {isTranscriptRecordingActive && (
            <p className="text-xs text-muted-foreground">Stop the chat transcript to enable recording.</p>
        )}
      </div>
      <div className="flex-grow overflow-y-auto bg-card rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Finished Recordings</h2>
        <div className="space-y-2">
          {finishedRecordings.length > 0 ? (
            finishedRecordings.map((rec) => (
              <div key={rec.s3Key} className="flex items-center justify-between p-2 border rounded-md">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={rec.filename}>{rec.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(rec.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center space-x-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownloadRecording(rec.s3Key, rec.filename)}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEmbedRecording(rec.s3Key)}
                    disabled={isEmbedding[rec.s3Key]}
                    title="Bookmark to Memory"
                  >
                    {isEmbedding[rec.s3Key] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No recordings yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecordView;
