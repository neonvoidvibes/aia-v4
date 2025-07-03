"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Download, Bookmark, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  agentCapabilities: { pinecone_index_exists: boolean };
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
  agentCapabilities,
}) => {
  const [finishedRecordings, setFinishedRecordings] = useState<FinishedRecording[]>([]);
  const [isEmbedding, setIsEmbedding] = useState<Record<string, boolean>>({});
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPineconeEnabled = agentCapabilities.pinecone_index_exists;

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

  const handlePauseRecording = async () => {
    if (!globalRecordingStatus.sessionId) return;

    stopTimer();
    try {
      const response = await fetch('/api/audio-recording-proxy?action=pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: globalRecordingStatus.sessionId }),
      });
      const data = await response.json();
      if (response.ok) {
        setGlobalRecordingStatus(prev => ({ ...prev, isPaused: true }));
        toast.info("Recording paused.");
      } else {
        throw new Error(data.message || "Failed to pause recording.");
      }
    } catch (error) {
      console.error("Error pausing recording:", error);
      toast.error((error as Error).message);
    }
  };

  const handleResumeRecording = async () => {
    if (!globalRecordingStatus.sessionId) return;

    try {
      const response = await fetch('/api/audio-recording-proxy?action=resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: globalRecordingStatus.sessionId }),
      });
      const data = await response.json();
      if (response.ok) {
        setGlobalRecordingStatus(prev => ({ ...prev, isPaused: false }));
        startTimer();
        toast.success("Recording resumed.");
      } else {
        throw new Error(data.message || "Failed to resume recording.");
      }
    } catch (error) {
      console.error("Error resuming recording:", error);
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
          filename: data.s3Key.split('/').pop()!,
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
  const isPaused = isRecording && globalRecordingStatus.isPaused;

  const handlePlayPauseClick = () => {
    if (!isRecording) {
      handleStartRecording();
    } else if (isPaused) {
      handleResumeRecording();
    } else {
      handlePauseRecording();
    }
  };

  return (
    <div className="flex flex-col h-full p-4 items-center justify-center">
      <div className="flex flex-col items-center justify-center space-y-2 w-full max-w-md">
        {/* Controls */}
        <div className="flex items-center justify-center space-x-4">
          <Button
            onClick={handlePlayPauseClick}
            disabled={isTranscriptRecordingActive || !isPineconeEnabled}
            className={cn(
              "flex items-center h-12 px-6 rounded-md text-foreground",
              "disabled:opacity-25 disabled:cursor-not-allowed",
              "transition-colors duration-200",
              isRecording ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary hover:bg-primary/90 text-primary-foreground"
            )}
            title={isRecording ? "Pause Recording" : "Start Recording"}
          >
            {isRecording && !isPaused ? (
              <Pause className="w-5 h-5 mr-2" fill="currentColor" />
            ) : (
              <Play className="w-5 h-5 mr-2" fill="currentColor" />
            )}
            <span className="text-base">{isRecording ? (isPaused ? "Resume" : "Pause") : "Record"}</span>
          </Button>
          <Button
            onClick={handleStopRecording}
            disabled={!isRecording || !isPineconeEnabled}
            className={cn(
              "flex items-center h-12 px-6 rounded-md text-foreground",
              "disabled:opacity-25 disabled:cursor-not-allowed",
              "transition-colors duration-200",
              "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
            )}
            title="Stop Recording"
          >
            <Square className="w-5 h-5 mr-2" />
            <span className="text-base">Stop</span>
          </Button>
        </div>
        {(isTranscriptRecordingActive || !isPineconeEnabled) && (
            <p className="text-xs text-muted-foreground text-center">
                {!isPineconeEnabled ? "Agent has no memory index. Recording disabled." : "Stop the chat transcript to enable recording."}
            </p>
        )}

        {/* Finished Recordings Section */}
        <div className="w-full pt-4">
          <h2 className="text-lg font-semibold text-center mb-2">Finished Recordings</h2>
          <div className="overflow-y-auto space-y-1 px-1" style={{ maxHeight: 'calc(100vh - 350px)' }}>
            {finishedRecordings.length > 0 ? (
              finishedRecordings.map((rec) => (
                <div key={rec.s3Key} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
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
                      disabled={!isPineconeEnabled}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEmbedRecording(rec.s3Key)}
                      disabled={isEmbedding[rec.s3Key] || !isPineconeEnabled}
                      title="Bookmark to Memory"
                      className={!isPineconeEnabled ? 'cursor-not-allowed' : ''}
                    >
                      {isEmbedding[rec.s3Key] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center pt-4">
                  <p className="text-sm text-muted-foreground text-center">No recordings yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecordView;
