"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, Download, XCircle, Trash2, ListCollapse, CheckCircle2, Clock, StopCircle, RotateCcw, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress"; // Added Progress import
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from '@/lib/utils';

const truncateString = (str: string, maxLength: number) => {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '... (truncated)';
};

interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

interface FinishedTranscriptItem {
  id: string;
  fileName: string;
  transcriptText: string; // Raw full text
  segments: WhisperSegment[];
  timestamp: number; // For sorting
}

interface CurrentProcessingFileState {
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
}

interface FullFileTranscriberProps {
  agentName: string | null;
  userName: string | null; // Added userName prop
}

interface PersistentTranscriberState {
  currentProcessingFile: CurrentProcessingFileState | null;
  currentTranscriptText: string | null; 
  currentSegments: WhisperSegment[] | null; 
  currentStatusMessage: string | null;
  currentErrorMessage: string | null;
  wasTranscribing?: boolean;
  currentJobId?: string | null;
}

const CURRENT_STATE_LOCAL_STORAGE_KEY = 'fullFileTranscriberCurrentState';
const FINISHED_TRANSCRIPTS_LOCAL_STORAGE_KEY = 'fullFileTranscriberFinishedList';


const formatTimestampForDownload = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const clusterSegmentsForDownload = (
    segments: WhisperSegment[], 
    maxClusterDuration: number = 20, 
    maxSentencesPerCluster: number = 3 
  ): string => {
  if (!segments || segments.length === 0) return "";

  const clusteredLines: string[] = [];
  let currentCluster = {
    startTime: segments[0].start,
    endTime: segments[0].end,
    texts: [segments[0].text.trim()],
    sentenceCount: 1, 
  };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const segmentText = segment.text.trim();
    if (!segmentText) continue;

    const potentialEndTime = segment.end;
    const clusterDuration = potentialEndTime - currentCluster.startTime;

    if (clusterDuration < maxClusterDuration && currentCluster.sentenceCount < maxSentencesPerCluster) {
      currentCluster.texts.push(segmentText);
      currentCluster.endTime = potentialEndTime;
      currentCluster.sentenceCount++; 
    } else {
      const startTimeStr = formatTimestampForDownload(currentCluster.startTime);
      const endTimeStr = formatTimestampForDownload(currentCluster.endTime);
      clusteredLines.push(`[${startTimeStr} - ${endTimeStr}] ${currentCluster.texts.join(' ')}`);
      
      currentCluster = {
        startTime: segment.start,
        endTime: segment.end,
        texts: [segmentText],
        sentenceCount: 1,
      };
    }
  }

  if (currentCluster.texts.length > 0) {
    const startTimeStr = formatTimestampForDownload(currentCluster.startTime);
    const endTimeStr = formatTimestampForDownload(currentCluster.endTime);
    clusteredLines.push(`[${startTimeStr} - ${endTimeStr}] ${currentCluster.texts.join(' ')}`);
  }

  return clusteredLines.join('\n'); 
};


const FullFileTranscriber: React.FC<FullFileTranscriberProps> = ({ agentName, userName }) => { // Added userName to props
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [currentRawTranscriptText, setCurrentRawTranscriptText] = useState<string | null>(null);
  const [currentTranscriptSegments, setCurrentTranscriptSegments] = useState<WhisperSegment[] | null>(null);
  const [currentPersistedFileInfo, setCurrentPersistedFileInfo] = useState<CurrentProcessingFileState | null>(null);
  
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null); 
  const [errorMessage, setErrorMessage] = useState<string | null>(null);   

  const [finishedTranscripts, setFinishedTranscripts] = useState<FinishedTranscriptItem[]>([]);

  // State for estimated progress bar
  const [estimatedProgress, setEstimatedProgress] = useState<number>(0);
  const [adjustedTotalDurationSeconds, setAdjustedTotalDurationSeconds] = useState<number | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptionStartTimeRef = useRef<number | null>(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
  
  // Smooth progress animation states
  const [realProgress, setRealProgress] = useState<number>(0);
  const [smoothProgress, setSmoothProgress] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(1);
  const smoothProgressRef = useRef<number>(0);
  const realProgressRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const [showCompletedTranscripts, setShowCompletedTranscripts] = useState<boolean>(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState<boolean>(false);
  const [isActuallyTranscribing, setIsActuallyTranscribing] = useState<boolean>(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);


  const fileInputRef = useRef<HTMLInputElement>(null);

  // State restoration effect (without dependencies)
  useEffect(() => {
    const savedCurrentStateString = localStorage.getItem(CURRENT_STATE_LOCAL_STORAGE_KEY);
    if (savedCurrentStateString) {
      try {
        const savedCurrent = JSON.parse(savedCurrentStateString) as PersistentTranscriberState;
        if (savedCurrent.currentProcessingFile) {
          setCurrentPersistedFileInfo(savedCurrent.currentProcessingFile);
        }

        if (savedCurrent.currentTranscriptText !== null && savedCurrent.currentSegments !== null) {
          // Job completed - restore completed state but don't start polling
          setCurrentRawTranscriptText(savedCurrent.currentTranscriptText);
          setCurrentTranscriptSegments(savedCurrent.currentSegments);
          if (savedCurrent.currentStatusMessage && (savedCurrent.currentStatusMessage.includes("complete") || savedCurrent.currentStatusMessage.includes("loaded"))) {
            setStatusMessage(savedCurrent.currentStatusMessage);
          } else if (savedCurrent.currentProcessingFile?.fileName){
             setStatusMessage(`Previously transcribed file '${savedCurrent.currentProcessingFile.fileName}' loaded.`);
          }
          // Ensure we don't resume polling for completed jobs
          setIsTranscribing(false);
          setIsActuallyTranscribing(false);
          setCurrentJobId(null);
        } else if (savedCurrent.wasTranscribing && savedCurrent.currentJobId && !savedCurrent.currentTranscriptText) {
          // Only resume polling if job was truly interrupted (no transcript result yet)
          setIsTranscribing(true);
          setIsActuallyTranscribing(true);
          setCurrentJobId(savedCurrent.currentJobId);
          setStatusMessage(`Resuming transcription job...`);
        } else if (savedCurrent.wasTranscribing && savedCurrent.currentProcessingFile?.fileName) {
          setStatusMessage(`Processing for ${savedCurrent.currentProcessingFile.fileName} was interrupted. Please select the file again to restart transcription.`);
        } else if (savedCurrent.currentStatusMessage) { 
            setStatusMessage(savedCurrent.currentStatusMessage);
        }
        
        if (savedCurrent.currentErrorMessage) {
          setErrorMessage(savedCurrent.currentErrorMessage);
        }
      } catch (e) {
        console.error("Failed to parse current transcriber state:", e);
        localStorage.removeItem(CURRENT_STATE_LOCAL_STORAGE_KEY);
      }
    }

    const savedFinishedListString = localStorage.getItem(FINISHED_TRANSCRIPTS_LOCAL_STORAGE_KEY);
    if (savedFinishedListString) {
      try {
        const savedList = JSON.parse(savedFinishedListString) as FinishedTranscriptItem[];
        setFinishedTranscripts(savedList);
      } catch (e) {
        console.error("Failed to parse finished transcripts list:", e);
        localStorage.removeItem(FINISHED_TRANSCRIPTS_LOCAL_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const stateToSave: PersistentTranscriberState = {
      currentProcessingFile: selectedFile 
        ? { fileName: selectedFile.name, fileSize: selectedFile.size, fileType: selectedFile.type } 
        : currentPersistedFileInfo,
      currentTranscriptText: currentRawTranscriptText,
      currentSegments: currentTranscriptSegments,
      currentStatusMessage: statusMessage,
      currentErrorMessage: errorMessage,
      wasTranscribing: isTranscribing,
      currentJobId: currentJobId,
    };
    localStorage.setItem(CURRENT_STATE_LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [selectedFile, currentPersistedFileInfo, currentRawTranscriptText, currentTranscriptSegments, statusMessage, errorMessage, isTranscribing, currentJobId]);

  useEffect(() => {
    if (finishedTranscripts.length > 0) {
      localStorage.setItem(FINISHED_TRANSCRIPTS_LOCAL_STORAGE_KEY, JSON.stringify(finishedTranscripts));
    } else {
      localStorage.removeItem(FINISHED_TRANSCRIPTS_LOCAL_STORAGE_KEY);
    }
  }, [finishedTranscripts]);

  // This effect is now simplified as the progress is driven by XHR during upload.
  useEffect(() => {
    // When transcription is complete or has an error, ensure progress is set to a final state.
    if (!isTranscribing) {
      if (currentRawTranscriptText !== null) {
        setEstimatedProgress(100); // Success
      } else if (errorMessage) {
        // Optionally reset or handle error state for progress
      }
      setEstimatedTimeRemaining(null);
    }
  }, [isTranscribing, currentRawTranscriptText, errorMessage]);

  // Update estimated time remaining during transcription
  useEffect(() => {
    if (isTranscribing && transcriptionStartTimeRef.current) {
      const interval = setInterval(() => {
        const elapsed = Date.now() - transcriptionStartTimeRef.current!;
        if (estimatedProgress > 10) {
          const totalEstimated = (elapsed / estimatedProgress) * 100;
          const remaining = totalEstimated - elapsed;
          if (remaining > 0) {
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            setEstimatedTimeRemaining(minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
          }
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isTranscribing, estimatedProgress]);

  // Polling function for job status
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/transcription/status/${jobId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to get job status');
      }

      const jobStatus = await response.json();
      console.log('Job status polling:', jobStatus); // Enhanced debug log
      
      // Update real progress and chunk info for smooth animation
      const newRealProgress = (jobStatus.progress || 0) * 100; // Keep decimal precision
      const chunks = jobStatus.total_chunks || 1;
      
      setRealProgress(newRealProgress);
      setTotalChunks(chunks);
      realProgressRef.current = newRealProgress;
      
      console.log('Progress update:', { newRealProgress, chunks, smooth: smoothProgressRef.current });
      
      // Update status message - PERCENTAGE ONLY, no chunk/segment references
      let statusMsg;
      
      // Show only user-friendly messages based on percentage
      if (newRealProgress < 15) {
        statusMsg = 'Preparing transcription...';
      } else if (newRealProgress < 95) {
        statusMsg = 'Processing audio...';
      } else {
        statusMsg = 'Finalizing transcription...';
      }
      
      setStatusMessage(statusMsg);

      if (jobStatus.status === 'completed' && jobStatus.result) {
        // Job completed successfully - FORCE completion state immediately
        console.log('Job completed - forcing completion state');
        
        // Stop all animations and polling FIRST
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        
        // Set completion state
        setRealProgress(100);
        realProgressRef.current = 100;
        setSmoothProgress(100);
        smoothProgressRef.current = 100;
        setIsTranscribing(false);
        setIsActuallyTranscribing(false);
        setCurrentJobId(null);

        // Process the result
        const result = jobStatus.result;
        if (result.transcript && result.segments) {
          setCurrentRawTranscriptText(result.transcript);
          setCurrentTranscriptSegments(result.segments);
          
          // Handle partial results with appropriate messaging
          if (result.partial && result.success_rate) {
            const successPercentage = Math.round(result.success_rate * 100);
            setStatusMessage(`Transcription completed (${successPercentage}% success)`);
            if (result.warning) {
              setErrorMessage(`⚠️ ${result.warning}`);
            }
          } else {
            setStatusMessage('Transcription complete!');
            setErrorMessage(null);
          }

          // Add to finished transcripts - only if not already added
          const currentJobIdForComparison = currentJobId;
          setFinishedTranscripts(prev => {
            // Check if we already have a transcript from this job
            const existsAlready = prev.some(item => 
              item.transcriptText === result.transcript && 
              item.fileName === (currentPersistedFileInfo?.fileName || "Unknown File")
            );
            
            if (existsAlready) {
              return prev; // Don't add duplicate
            }
            
            const newFinishedItem: FinishedTranscriptItem = {
              id: Date.now().toString(),
              fileName: currentPersistedFileInfo?.fileName || "Unknown File",
              transcriptText: result.transcript,
              segments: result.segments,
              timestamp: Date.now()
            };
            return [newFinishedItem, ...prev.slice(0, 9)];
          });
        }
      } else if (jobStatus.status === 'failed') {
        // Job failed
        setIsTranscribing(false);
        setIsActuallyTranscribing(false);
        setCurrentJobId(null);
        setErrorMessage(jobStatus.error || 'Transcription failed');
        setStatusMessage(null);
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else if (jobStatus.status === 'cancelled') {
        // Job cancelled
        setIsTranscribing(false);
        setIsActuallyTranscribing(false);
        setCurrentJobId(null);
        setStatusMessage('Transcription cancelled');
        setErrorMessage(null);
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
      // If status is still 'processing' or 'queued', continue polling
      
      // Return true if job is completed (success, failed, or cancelled)
      return ['completed', 'failed', 'cancelled'].includes(jobStatus.status);
      
    } catch (error: any) {
      console.error('Error polling job status:', error);
      
      // If job not found (404) or server error after completion, assume job is done
      if (error.message?.includes('Failed to get job status')) {
        setErrorMessage('Transcription completed but status unavailable');
        setIsTranscribing(false);
        setIsActuallyTranscribing(false);
        setCurrentJobId(null);
        
        if (pollingIntervalRef.current) {
          clearTimeout(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        
        return true; // Stop polling on persistent error
      }
      
      return false; // Continue polling on other errors
    }
  }, [currentPersistedFileInfo]);

  // Start polling for a job
  const startPolling = useCallback((jobId: string) => {
    setCurrentJobId(jobId);
    
    // Initial poll
    pollJobStatus(jobId);
    
    // Set up polling with smart intervals and better error handling
    let pollCount = 0;
    const pollInterval = () => {
      pollCount++;
      // Smart polling: 1s for first 10 polls, then 2s for next 20, then 3s
      const interval = pollCount <= 10 ? 1000 : pollCount <= 30 ? 2000 : 3000;
      
      pollingIntervalRef.current = setTimeout(() => {
        pollJobStatus(jobId).then((jobCompleted) => {
          // Continue polling if job is still active and not completed
          const currentJob = currentJobId === jobId;
          const stillTranscribing = isTranscribing;
          
          // Debug log to catch runaway polling
          console.log('Polling check:', { currentJob, stillTranscribing, jobId, currentJobId, jobCompleted });
          
          // Stop polling if job is actually completed, regardless of other state
          if (jobCompleted) {
            console.log('Stopping polling - job completed');
            if (pollingIntervalRef.current) {
              clearTimeout(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          } else if (currentJob && stillTranscribing) {
            pollInterval();
          } else if (jobCompleted === false) {
            // Job is still active but polling state got confused - continue polling
            console.log('Continuing polling - job still active');
            pollInterval();
          } else {
            // Job cancelled or other termination
            console.log('Stopping polling - job terminated');
            if (pollingIntervalRef.current) {
              clearTimeout(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        }).catch((error) => {
          console.error('Polling error:', error);
          // Stop polling after multiple errors - job likely deleted
          console.log('Stopping polling due to error - assuming job completed');
          if (pollingIntervalRef.current) {
            clearTimeout(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        });
      }, interval);
    };
    
    pollInterval();
  }, [pollJobStatus, currentJobId]);

  // Job recovery effect - start polling for recovered jobs
  useEffect(() => {
    if (currentJobId && isTranscribing && isActuallyTranscribing && !pollingIntervalRef.current) {
      // This is likely a recovered job, start polling
      startPolling(currentJobId);
    }
  }, [currentJobId, isTranscribing, isActuallyTranscribing, startPolling]);

  // Smooth progress animation anchored to real chunk completion with satisfying UX
  useEffect(() => {
    if (!isTranscribing || !isActuallyTranscribing) {
      // Stop animation immediately if not actually transcribing
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const animateProgress = () => {
      // Double check we're still actually transcribing to prevent runaway
      if (!isTranscribing || !isActuallyTranscribing) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }
      
      const currentSmooth = smoothProgressRef.current;
      const targetReal = realProgressRef.current;
      
      // Hard cap at 100% to prevent runaway
      if (currentSmooth >= 100 || targetReal >= 100) {
        smoothProgressRef.current = Math.min(100, Math.max(currentSmooth, targetReal));
        setSmoothProgress(Math.floor(smoothProgressRef.current));
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }
      
      // Calculate chunk-based progress bounds
      // Each chunk represents roughly (100 / totalChunks)% when completed
      const progressPerChunk = 100 / Math.max(totalChunks, 1);
      const completedChunkProgress = Math.floor(targetReal / progressPerChunk) * progressPerChunk;
      const nextChunkProgress = completedChunkProgress + progressPerChunk;
      
      // Allow smooth movement within current chunk range, but don't exceed next chunk boundary
      const maxAllowedProgress = Math.min(nextChunkProgress - 2, targetReal + 3); // Stay 2% below next chunk
      
      // Smooth animation logic anchored to chunk boundaries
      if (currentSmooth >= maxAllowedProgress) {
        // At chunk boundary - gentle micro-movement to show activity
        const microIncrement = 0.01; // Very small movement
        const newSmooth = Math.min(currentSmooth + microIncrement, maxAllowedProgress);
        
        smoothProgressRef.current = newSmooth;
        setSmoothProgress(Math.floor(newSmooth));
      } else if (Math.abs(currentSmooth - targetReal) < 1) {
        // Close to actual progress - gentle forward movement within chunk bounds
        const incrementSpeed = 0.03; // Gentle continuous movement
        const newSmooth = Math.min(currentSmooth + incrementSpeed, maxAllowedProgress);
        
        smoothProgressRef.current = newSmooth;
        setSmoothProgress(Math.floor(newSmooth));
      } else if (currentSmooth < targetReal) {
        // Catch up to real progress smoothly but respect chunk boundaries
        const gap = Math.min(targetReal - currentSmooth, maxAllowedProgress - currentSmooth);
        const catchUpSpeed = Math.max(gap * 0.06, 0.1); // 6% of gap, minimum 0.1% per frame
        const newSmooth = Math.min(currentSmooth + catchUpSpeed, maxAllowedProgress);
        
        smoothProgressRef.current = newSmooth;
        setSmoothProgress(Math.floor(newSmooth));
      } else {
        // Don't move backwards - just gentle micro-movement
        const incrementSpeed = 0.005;
        const newSmooth = Math.min(currentSmooth + incrementSpeed, maxAllowedProgress);
        
        smoothProgressRef.current = newSmooth;
        setSmoothProgress(Math.floor(newSmooth));
      }
      
      // Continue animation only if still transcribing and under 100%
      const updatedSmooth = smoothProgressRef.current;
      const updatedReal = realProgressRef.current;
      if (isTranscribing && isActuallyTranscribing && updatedSmooth < 100 && updatedReal < 100) {
        animationFrameRef.current = requestAnimationFrame(animateProgress);
      } else {
        // Stop if we've reached completion
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animateProgress);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isTranscribing, isActuallyTranscribing, totalChunks]);

  // Cancel current transcription job
  const cancelTranscription = useCallback(async () => {
    if (!currentJobId || !isActuallyTranscribing) {
      // Don't try to cancel if no job or job already completed
      setIsTranscribing(false);
      setIsActuallyTranscribing(false);
      setStatusMessage('Transcription cancelled');
      setCurrentJobId(null);
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }
    
    try {
      const response = await fetch(`/api/transcription/cancel/${currentJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        setIsTranscribing(false);
        setIsActuallyTranscribing(false);
        setStatusMessage('Transcription cancelled');
        setCurrentJobId(null);
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        
        // Don't clear file info so user can retry
      } else {
        const error = await response.json();
        // If job is already completed/not found, just update UI state
        if (response.status === 400 || response.status === 404) {
          setIsTranscribing(false);
          setIsActuallyTranscribing(false);
          setStatusMessage('Transcription completed');
          setCurrentJobId(null);
          
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        } else {
          setErrorMessage(error.message || 'Failed to cancel transcription');
        }
      }
    } catch (error: any) {
      console.error('Error cancelling transcription:', error);
      setErrorMessage('Failed to cancel transcription');
    }
  }, [currentJobId, isActuallyTranscribing]);

  // Retry failed transcription
  const retryTranscription = useCallback(() => {
    setErrorMessage(null);
    setStatusMessage(null);
    setCurrentRawTranscriptText(null);
    setCurrentTranscriptSegments(null);
    setEstimatedProgress(0);
    handleStartTranscription();
  }, []);
  
  const clearCurrentProcessingStateUI = () => {
    setSelectedFile(null);
    setCurrentRawTranscriptText(null);
    setCurrentTranscriptSegments(null);
    setStatusMessage(null);
    setErrorMessage(null);
    setCurrentPersistedFileInfo(null);
    setIsTranscribing(false); 
    setIsActuallyTranscribing(false); 
    setCurrentJobId(null);
    setEstimatedProgress(0);
    setRealProgress(0);
    setSmoothProgress(0);
    setTotalChunks(1);
    smoothProgressRef.current = 0;
    realProgressRef.current = 0;
    setAdjustedTotalDurationSeconds(null);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = null;
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    transcriptionStartTimeRef.current = null;
    if(fileInputRef.current) fileInputRef.current.value = "";
    
    // Clear localStorage keys
    localStorage.removeItem(CURRENT_STATE_LOCAL_STORAGE_KEY);
  };


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        setErrorMessage('Invalid file type. Please select an audio file.');
        setSelectedFile(null); 
        if(fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setCurrentRawTranscriptText(null);
      setCurrentTranscriptSegments(null);
      setStatusMessage(null);
      setErrorMessage(null);
      setIsTranscribing(false);

      setSelectedFile(file);
      setCurrentPersistedFileInfo({fileName: file.name, fileSize: file.size, fileType: file.type}); 
    }
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file) {
       if (!file.type.startsWith('audio/')) {
        setErrorMessage('Invalid file type. Please drop an audio file.');
        setSelectedFile(null); 
        return;
      }
      setCurrentRawTranscriptText(null);
      setCurrentTranscriptSegments(null);
      setStatusMessage(null);
      setErrorMessage(null);
      setIsTranscribing(false);

      setSelectedFile(file);
      setCurrentPersistedFileInfo({fileName: file.name, fileSize: file.size, fileType: file.type}); 
    }
  }, []); 

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleStartTranscription = async () => {
    transcriptionStartTimeRef.current = Date.now();
    const fileToTranscribe = selectedFile; 
    const fileInfoForProcessing = selectedFile 
      ? { fileName: selectedFile.name, fileSize: selectedFile.size, fileType: selectedFile.type }
      : currentPersistedFileInfo;

    if (!fileToTranscribe) { 
      if (fileInfoForProcessing) {
        setErrorMessage(`Please re-select the audio file '${fileInfoForProcessing.fileName}' to start transcription.`);
      } else {
        setErrorMessage('Please select an audio file first.');
      }
      return;
    }
    if (!agentName) {
      setErrorMessage("Agent not selected. Cannot start transcription.");
      return;
    }

    setIsTranscribing(true);
    setStatusMessage("Preparing upload...");
    setErrorMessage(null);
    setCurrentRawTranscriptText(null); 
    setCurrentTranscriptSegments(null);
    setEstimatedProgress(0);
    setRealProgress(0);
    setSmoothProgress(0);
    smoothProgressRef.current = 0;
    realProgressRef.current = 0;
    transcriptionStartTimeRef.current = Date.now();
    
    try {
      // Step 1: Get presigned URL from our backend
      const presignedUrlResponse = await fetch('/api/s3/generate-presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: agentName,
          filename: fileToTranscribe.name,
          fileType: fileToTranscribe.type,
        }),
      });

      if (!presignedUrlResponse.ok) {
        const errorData = await presignedUrlResponse.json();
        throw new Error(errorData.error || "Failed to prepare upload.");
      }
      const presignedData = await presignedUrlResponse.json();

      // Step 2: Upload file directly to S3 using XHR for progress
      setStatusMessage("Uploading to secure storage...");
      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        Object.entries(presignedData.fields).forEach(([key, value]) => {
          formData.append(key, value as string);
        });
        formData.append('file', fileToTranscribe);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', presignedData.url, true);
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            setEstimatedProgress(progress);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`S3 Upload Failed: Status ${xhr.status}. ${xhr.responseText}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error("S3 Upload Failed: Network error."));
        };
        
        xhr.send(formData);
      });
      
      setStatusMessage("Upload complete. Starting transcription job...");
      setEstimatedProgress(100); // Mark upload as complete

      // Step 3: Start async transcription job
      const transcriptionLanguage = localStorage.getItem(`transcriptionLanguageSetting_${agentName}`) || "any";
      const startJobResponse = await fetch('/api/transcription/start-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: agentName,
          s3Key: presignedData.s3Key,
          originalFilename: fileToTranscribe.name,
          transcriptionLanguage: transcriptionLanguage,
        }),
      });
      
      const result = await startJobResponse.json();
      if (!startJobResponse.ok) {
        throw new Error(result.error || "Failed to start transcription job.");
      }

      // Step 4: Start polling for job status
      if (result.job_id) {
        setStatusMessage("Transcription job started. Processing...");
        setIsActuallyTranscribing(true);
        startPolling(result.job_id);
      } else {
        throw new Error("No job ID received from backend.");
      }
      
    } catch (err: any) {
      console.error('Transcription process error:', err);
      setErrorMessage(err.message || 'An unknown error occurred.');
      setStatusMessage(null); 
      setIsActuallyTranscribing(false);
      setIsTranscribing(false);
    }
  };

  const downloadSpecificTranscript = (item: FinishedTranscriptItem) => {
    const clusteredContent = clusterSegmentsForDownload(item.segments);
    const downloadTimestampUtc = new Date(item.timestamp).toISOString().split('.')[0].replace('T', ' '); // Format to YYYY-MM-DD HH:mm:ss
    
    const header =
`# Transcript - Uploaded
Agent: ${agentName || 'UnknownAgent'}
User: ${userName || 'UnknownUser'}
Transcript Uploaded (UTC): ${downloadTimestampUtc}

`; // Two newlines after header

    const contentWithHeader = header + clusteredContent;
    const blob = new Blob([contentWithHeader], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = item.fileName.substring(0, item.fileName.lastIndexOf('.')) || item.fileName;
    link.download = `${baseName}_transcript.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleDownloadCurrentTranscript = () => {
    const fileInfo = currentPersistedFileInfo; // Use the persisted info for naming
    if (!currentRawTranscriptText || !currentTranscriptSegments || !fileInfo) return;
    
    const clusteredContent = clusterSegmentsForDownload(currentTranscriptSegments);
    const uploadTimestampUtc = new Date().toISOString().split('.')[0].replace('T', ' '); // Current time for new downloads, YYYY-MM-DD HH:mm:ss

    const header =
`# Transcript - Uploaded
Agent: ${agentName || 'UnknownAgent'}
User: ${userName || 'UnknownUser'}
Transcript Uploaded (UTC): ${uploadTimestampUtc}

`; // Two newlines after header

    const contentWithHeader = header + clusteredContent;
    const blob = new Blob([contentWithHeader], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = fileInfo.fileName ? (fileInfo.fileName.substring(0, fileInfo.fileName.lastIndexOf('.')) || fileInfo.fileName) : "transcript";
    link.download = `${baseName}_transcript.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const removeFinishedTranscript = (idToRemove: string) => {
    setFinishedTranscripts(prev => prev.filter(item => item.id !== idToRemove));
  };

  const clearAllFinishedTranscripts = () => {
    setFinishedTranscripts([]);
    setShowClearAllConfirm(false);
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const displayFileInfoForCurrent = currentPersistedFileInfo;

  const canTranscribe = !!displayFileInfoForCurrent && !isTranscribing; 
  const canDownloadCurrent = (currentRawTranscriptText !== null && currentTranscriptSegments !== null) && !!displayFileInfoForCurrent && !isTranscribing;
  const hasCompletedTranscripts = finishedTranscripts.length > 0;

  // Get current state for the unified card
  const getCardState = () => {
    if (errorMessage) return 'error';
    if (currentRawTranscriptText && currentTranscriptSegments) return 'completed';
    if (isTranscribing) return 'processing';
    if (displayFileInfoForCurrent) return 'ready';
    return 'empty';
  };

  const cardState = getCardState();

  return (
    <div className="space-y-4 p-1 sm:p-0">
      {/* Unified File Processing Card */}
      <div className={cn(
        "border-2 rounded-lg transition-all duration-200",
        cardState === 'empty' ? "border-dashed border-border hover:border-primary cursor-pointer hover:bg-muted/20" : 
        cardState === 'error' ? "border-destructive bg-destructive/5" :
        cardState === 'completed' ? "border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-950/30" :
        cardState === 'processing' ? "border-primary bg-primary/5" :
        "border-primary/50 bg-muted/20"
      )}>
        {/* Upload Area or File Info */}
        <div 
          className={cn(
            "p-6 sm:p-8",
            cardState === 'empty' && "flex flex-col items-center justify-center cursor-pointer"
          )}
          onClick={cardState === 'empty' ? () => fileInputRef.current?.click() : undefined}
          onDrop={cardState === 'empty' ? handleDrop : undefined}
          onDragOver={cardState === 'empty' ? handleDragOver : undefined}
        >
          <input
            type="file"
            accept="audio/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            id="audio-upload-input"
            aria-label="Audio file uploader"
          />
          
          {cardState === 'empty' && (
            <>
              <UploadCloud className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mb-3" />
              <p className="text-sm text-center text-muted-foreground">
                <span className="font-semibold text-primary">Click to upload</span> or drag and drop <br className="sm:hidden"/>MP3, MP4, WAV, M4A, WEBM, etc.
              </p>
            </>
          )}
          
          {cardState !== 'empty' && (
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {cardState === 'completed' ? (
                  <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                ) : cardState === 'processing' ? (
                  <Loader2 className="w-6 h-6 text-primary animate-spin flex-shrink-0" />
                ) : cardState === 'error' ? (
                  <XCircle className="w-6 h-6 text-destructive flex-shrink-0" />
                ) : (
                  <FileText className="w-6 h-6 text-primary flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-base font-medium text-foreground truncate" title={displayFileInfoForCurrent?.fileName || 'Transcription'}>
                    {displayFileInfoForCurrent?.fileName || 'Completed transcription'}
                  </p>
                  <p className="text-sm text-muted-foreground">{displayFileInfoForCurrent ? formatFileSize(displayFileInfoForCurrent.fileSize) : 'Ready for new upload'}</p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                onClick={clearCurrentProcessingStateUI} 
                className="h-10 px-3 text-muted-foreground hover:text-primary flex items-center gap-2"
                title="Start new transcription"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="text-sm">Restart</span>
              </Button>
            </div>
          )}
          
          {/* Status and Progress */}
          {cardState === 'processing' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-primary">
                    {statusMessage || 'Processing...'}
                  </div>
                  {estimatedTimeRemaining && !isActuallyTranscribing && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>~{estimatedTimeRemaining} remaining</span>
                    </div>
                  )}
                </div>
                <div className="text-sm font-mono text-primary">
                  {smoothProgress}%
                </div>
              </div>
              <Progress value={smoothProgress} className="w-full h-2" />
            </div>
          )}
          
          {cardState === 'completed' && (
            <div className="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ Transcription completed successfully
            </div>
          )}
          
          {cardState === 'error' && errorMessage && (
            <div className="text-sm text-destructive font-medium">
              ✗ {errorMessage}
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        {cardState !== 'empty' && (
          <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3">
            {(cardState === 'ready' || cardState === 'error') && (
              <>
                <Button
                  onClick={cardState === 'error' ? retryTranscription : handleStartTranscription}
                  disabled={!canTranscribe}
                  className="w-full sm:flex-1"
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Transcribing...
                    </>
                  ) : cardState === 'error' ? (
                    <>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Retry Transcription
                    </>
                  ) : (
                    'Transcribe File'
                  )}
                </Button>
                
                {cardState === 'error' && (
                  <Button
                    onClick={clearCurrentProcessingStateUI}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    Start New
                  </Button>
                )}
              </>
            )}
            
            {cardState === 'processing' && (
              <Button
                onClick={cancelTranscription}
                variant="outline"
                className="w-full sm:flex-1"
                disabled={!currentJobId}
              >
                <StopCircle className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            )}
            
            {canDownloadCurrent && (
              <Button
                onClick={handleDownloadCurrentTranscript}
                variant={cardState === 'completed' ? 'default' : 'outline'}
                className="w-full sm:flex-1"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Transcript
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Completed Transcripts - Collapsible */}
      {hasCompletedTranscripts && (
        <div className="border rounded-lg">
          <Button 
            variant="ghost" 
            onClick={() => setShowCompletedTranscripts(!showCompletedTranscripts)}
            className="w-full p-4 h-auto justify-between hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <ListCollapse className="w-5 h-5" />
              <span className="font-medium">Completed Transcripts ({finishedTranscripts.length})</span>
            </div>
            <div className={cn(
              "transition-transform duration-200",
              showCompletedTranscripts ? "rotate-180" : ""
            )}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </Button>
          
          {showCompletedTranscripts && (
            <div className="border-t">
              <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
                <div className="flex justify-end mb-2">
                  <AlertDialog open={showClearAllConfirm} onOpenChange={setShowClearAllConfirm}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="mr-2 h-3 w-3" /> Clear All
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear All Transcripts</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to clear all completed transcripts? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={clearAllFinishedTranscripts}>
                          Clear All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {finishedTranscripts.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      <div className="truncate">
                        <p className="text-sm font-medium text-foreground truncate" title={item.fileName}>{item.fileName}</p>
                        <p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => downloadSpecificTranscript(item)} className="h-8 px-2 text-muted-foreground hover:text-primary">
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeFinishedTranscript(item.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <XCircle className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FullFileTranscriber;
