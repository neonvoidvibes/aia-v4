"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, Download, XCircle, AudioLines } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from '@/lib/utils';

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

interface PersistentTranscriberState {
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  transcriptText: string | null; // Full raw text
  segments: WhisperSegment[] | null; // For timestamped download
  statusMessage: string | null;
  errorMessage: string | null;
  wasTranscribing?: boolean; // New: to indicate if a transcription was in progress
}

const LOCAL_STORAGE_KEY = 'fullFileTranscriberState';

const formatTimestamp = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds * 1000) % 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

const FullFileTranscriber: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Store raw transcript text and segments separately
  const [rawTranscriptText, setRawTranscriptText] = useState<string | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<WhisperSegment[] | null>(null);
  
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // For displaying persisted file info even if File object is not available
  const [persistedFileInfo, setPersistedFileInfo] = useState<{name: string; size: number; type: string} | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load state from localStorage on mount
  useEffect(() => {
    const savedStateString = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedStateString) {
      try {
        const savedState = JSON.parse(savedStateString) as PersistentTranscriberState;
        
        if (savedState.fileName && savedState.fileSize !== null && savedState.fileType) {
            setPersistedFileInfo({ name: savedState.fileName, size: savedState.fileSize, type: savedState.fileType });
        }

        if (savedState.transcriptText !== null && savedState.segments !== null) { // Allow empty string/array
          setRawTranscriptText(savedState.transcriptText);
          setTranscriptSegments(savedState.segments);
          // Only restore "final" status messages from a completed/loaded state
          if (savedState.statusMessage && (savedState.statusMessage.includes("complete") || savedState.statusMessage.includes("loaded"))) {
             setStatusMessage(savedState.statusMessage);
          } else {
            // If we have results but no "final" status message, imply it was loaded.
             setStatusMessage(savedState.fileName ? `Previously transcribed file '${savedState.fileName}' loaded.` : "Previous transcription loaded.");
          }
        } else if (savedState.wasTranscribing && savedState.fileName) {
          // Transcription was in progress but didn't complete
          setStatusMessage(`Processing for ${savedState.fileName} was interrupted. Please select the file again to restart transcription.`);
          setErrorMessage(null); // Clear any old error message in this specific case
        } else if (savedState.statusMessage && (savedState.statusMessage.includes("complete") || savedState.statusMessage.includes("loaded"))) {
            // This case might happen if only status was saved but not results - less likely now
            setStatusMessage(savedState.statusMessage);
        } else {
            setStatusMessage(null); // Clear transient messages if no results and not interrupted
        }


        if (savedState.errorMessage) {
          setErrorMessage(savedState.errorMessage);
        }
      } catch (e) {
        console.error("Failed to parse persisted transcriber state:", e);
        localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear corrupted state
      }
    }
  }, []);

  // Save state to localStorage when relevant pieces change
  useEffect(() => {
    const stateToSave: PersistentTranscriberState = {
      fileName: selectedFile?.name || persistedFileInfo?.name || null,
      fileSize: selectedFile?.size ?? persistedFileInfo?.size ?? null,
      fileType: selectedFile?.type || persistedFileInfo?.type || null,
      transcriptText: rawTranscriptText,
      segments: transcriptSegments,
      statusMessage: statusMessage, 
      errorMessage: errorMessage,
      wasTranscribing: isTranscribing, 
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [selectedFile, persistedFileInfo, rawTranscriptText, transcriptSegments, statusMessage, errorMessage, isTranscribing]);


  const clearPersistedState = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
  
  const clearSelection = () => {
    setSelectedFile(null);
    setRawTranscriptText(null);
    setTranscriptSegments(null);
    setStatusMessage(null);
    setErrorMessage(null);
    setPersistedFileInfo(null); 
    clearPersistedState(); 
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        setErrorMessage('Invalid file type. Please select an audio file.');
        setSelectedFile(null);
        // If a previous valid file's info was displayed, keep it, but clear results.
        if (persistedFileInfo) {
            setRawTranscriptText(null); 
            setTranscriptSegments(null);
            // statusMessage might indicate previous success, let it stay or clear based on UX preference.
            // For now, clearing it for the invalid attempt.
            setStatusMessage(null); 
        } else {
            setPersistedFileInfo(null); // No previous valid file info to keep.
            setStatusMessage(null);
        }
        return;
      }
      // New valid file selected, reset results from any *previous* file
      setRawTranscriptText(null);
      setTranscriptSegments(null);
      setStatusMessage(null);
      setErrorMessage(null);

      setSelectedFile(file);
      setPersistedFileInfo({name: file.name, size: file.size, type: file.type}); 
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
        if (persistedFileInfo) { // Similar logic to handleFileChange
            setRawTranscriptText(null); 
            setTranscriptSegments(null);
            setStatusMessage(null);
        } else {
            setPersistedFileInfo(null);
            setStatusMessage(null);
        }
        return;
      }
      setRawTranscriptText(null);
      setTranscriptSegments(null);
      setStatusMessage(null);
      setErrorMessage(null);

      setSelectedFile(file);
      setPersistedFileInfo({name: file.name, size: file.size, type: file.type}); 
    }
  }, [persistedFileInfo]); // Removed rawTranscriptText, transcriptSegments to avoid loop with useEffect

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleStartTranscription = async () => {
    const currentFileToTranscribe = selectedFile;
    const currentFileNameForDisplay = selectedFile?.name || persistedFileInfo?.name; // Use selectedFile name first

    if (!currentFileToTranscribe) { 
      if (persistedFileInfo) {
        setErrorMessage(`Please re-select the audio file '${persistedFileInfo.name}' to transcribe.`);
      } else {
        setErrorMessage('Please select an audio file first.');
      }
      return;
    }


    setIsTranscribing(true);
    const processingMsg = `Processing: ${currentFileNameForDisplay}... This may take a few moments.`;
    setStatusMessage(processingMsg);
    setErrorMessage(null);
    setRawTranscriptText(null);
    setTranscriptSegments(null);
    
    const processingStateToSave: PersistentTranscriberState = {
      fileName: currentFileNameForDisplay || null, // Ensure null if undefined
      fileSize: currentFileToTranscribe.size,
      fileType: currentFileToTranscribe.type,
      transcriptText: null,
      segments: null,
      statusMessage: processingMsg, 
      errorMessage: null,
      wasTranscribing: true,
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(processingStateToSave));

    const formData = new FormData();
    formData.append('audio_file', currentFileToTranscribe);

    try {
      const response = await fetch('/api/transcribe-audio', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      console.log("[FullFileTranscriber] Received data from /api/transcribe-audio:", JSON.stringify(data, null, 2));


      if (!response.ok) {
        throw new Error(data.error || data.message || data.details || `Transcription failed with status ${response.status}`);
      }

      if (typeof data.transcript === 'string' && Array.isArray(data.segments)) { 
        setRawTranscriptText(data.transcript);
        setTranscriptSegments(data.segments);
        const completeMsg = 'Transcription complete!';
        setStatusMessage(completeMsg);
        const successStateToSave: PersistentTranscriberState = {
            fileName: currentFileNameForDisplay || null, // Ensure null if undefined
            fileSize: currentFileToTranscribe.size,
            fileType: currentFileToTranscribe.type,
            transcriptText: data.transcript,
            segments: data.segments,
            statusMessage: completeMsg,
            errorMessage: null,
            wasTranscribing: false,
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(successStateToSave));

      } else {
        console.error("Incomplete data received from backend:", data);
        throw new Error("Received incomplete transcription data from backend. Missing 'transcript' (string) or 'segments' (array).");
      }

    } catch (err: any) {
      console.error('Transcription error:', err);
      const finalErrorMessage = err.message || 'An unknown error occurred during transcription.';
      setErrorMessage(finalErrorMessage);
      setStatusMessage(null); 
      const errorStateToSave: PersistentTranscriberState = {
        fileName: currentFileNameForDisplay || null, // Ensure null if undefined
        fileSize: currentFileToTranscribe.size,
        fileType: currentFileToTranscribe.type,
        transcriptText: null,
        segments: null,
        statusMessage: null,
        errorMessage: finalErrorMessage,
        wasTranscribing: false,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(errorStateToSave));
    } finally {
      setIsTranscribing(false);
      const finalLsStateString = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (finalLsStateString) {
        try {
          const parsed = JSON.parse(finalLsStateString) as PersistentTranscriberState;
          if (parsed.wasTranscribing === true) { 
             localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({...parsed, wasTranscribing: false, statusMessage: statusMessage || parsed.statusMessage || null }));
          }
        } catch (e) { console.error("Error finalising wasTranscribing state in LS", e); }
      }
    }
  };

  const handleDownloadTranscript = () => {
    const fileNameForDownload = selectedFile?.name || persistedFileInfo?.name;
    if (!rawTranscriptText || !fileNameForDownload ) return;

    let content = "";
    if (transcriptSegments && transcriptSegments.length > 0) {
      content = transcriptSegments.map(segment => 
        `[${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}] ${segment.text.trim()}`
      ).join('\n\n'); 
    } else {
      content = rawTranscriptText;
      console.warn("Downloading raw transcript text as segments were not available or empty.");
    }
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const baseName = fileNameForDownload.substring(0, fileNameForDownload.lastIndexOf('.')) || fileNameForDownload;
    link.download = `${baseName}_transcript.txt`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const displayFileInfo = selectedFile 
    ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
    : persistedFileInfo;

  const canTranscribe = !!displayFileInfo && !isTranscribing; 
  const canDownload = (rawTranscriptText !== null || (transcriptSegments && transcriptSegments.length > 0)) && !!displayFileInfo && !isTranscribing;


  return (
    <div className="space-y-6 p-1 sm:p-0">
      <div 
        className={cn(
          "flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors",
          displayFileInfo ? "border-primary/50 bg-muted/20" : "border-border hover:bg-muted/20"
        )}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        aria-labelledby="audio-upload-label"
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
        <UploadCloud className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mb-2 sm:mb-3" />
        <p id="audio-upload-label" className="text-sm text-muted-foreground">
          <span className="font-semibold text-primary">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-muted-foreground">MP3, WAV, M4A, WEBM, etc.</p>
      </div>

      {displayFileInfo && (
        <div className="p-3 border rounded-md bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="truncate">
                <p className="text-sm font-medium text-foreground truncate" title={displayFileInfo.name}>{displayFileInfo.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(displayFileInfo.size)}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={clearSelection} className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Clear selected file">
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      
      {statusMessage && !errorMessage && (
        <Alert variant={(rawTranscriptText !== null || (transcriptSegments && transcriptSegments.length > 0)) ? "default" : "default"} className={cn((rawTranscriptText !== null || (transcriptSegments && transcriptSegments.length > 0)) && statusMessage.includes("complete") ? "border-green-500 dark:border-green-600" : "border-blue-500 dark:border-blue-600")}>
           <AlertTitle>{(rawTranscriptText !== null || (transcriptSegments && transcriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded")) ? "Success!" : "Status"}</AlertTitle>
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          onClick={handleStartTranscription}
          disabled={!canTranscribe}
          className="w-full sm:flex-1"
        >
          {isTranscribing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Transcribing...
            </>
          ) : (
            'Transcribe File'
          )}
        </Button>

        {canDownload && (
          <Button
            onClick={handleDownloadTranscript}
            variant="outline"
            className="w-full sm:flex-1"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Transcript
          </Button>
        )}
      </div>
    </div>
  );
};

export default FullFileTranscriber;