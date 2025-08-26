"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, Download, XCircle, Trash2, ListCollapse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress"; // Added Progress import
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


  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedCurrentStateString = localStorage.getItem(CURRENT_STATE_LOCAL_STORAGE_KEY);
    if (savedCurrentStateString) {
      try {
        const savedCurrent = JSON.parse(savedCurrentStateString) as PersistentTranscriberState;
        if (savedCurrent.currentProcessingFile) {
          setCurrentPersistedFileInfo(savedCurrent.currentProcessingFile);
        }

        if (savedCurrent.currentTranscriptText !== null && savedCurrent.currentSegments !== null) {
          setCurrentRawTranscriptText(savedCurrent.currentTranscriptText);
          setCurrentTranscriptSegments(savedCurrent.currentSegments);
          if (savedCurrent.currentStatusMessage && (savedCurrent.currentStatusMessage.includes("complete") || savedCurrent.currentStatusMessage.includes("loaded"))) {
            setStatusMessage(savedCurrent.currentStatusMessage);
          } else if (savedCurrent.currentProcessingFile?.fileName){
             setStatusMessage(`Previously transcribed file '${savedCurrent.currentProcessingFile.fileName}' loaded.`);
          }
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
    };
    localStorage.setItem(CURRENT_STATE_LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [selectedFile, currentPersistedFileInfo, currentRawTranscriptText, currentTranscriptSegments, statusMessage, errorMessage, isTranscribing]);

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
    }
  }, [isTranscribing, currentRawTranscriptText, errorMessage]);

  
  const clearCurrentProcessingStateUI = () => {
    setSelectedFile(null);
    setCurrentRawTranscriptText(null);
    setCurrentTranscriptSegments(null);
    setStatusMessage(null);
    setErrorMessage(null);
    setCurrentPersistedFileInfo(null);
    setIsTranscribing(false); 
    setEstimatedProgress(0); // Reset progress
    setAdjustedTotalDurationSeconds(null); // Reset duration
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = null;
    transcriptionStartTimeRef.current = null;
    if(fileInputRef.current) fileInputRef.current.value = "";
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

      // Step 3: Notify backend to start transcription job
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

      // Step 4: Process successful transcription result
      if (typeof result.transcript === 'string' && Array.isArray(result.segments)) {
        setCurrentRawTranscriptText(result.transcript);
        setCurrentTranscriptSegments(result.segments);
        const completeMsg = 'Transcription complete!';
        setStatusMessage(completeMsg);

        const newFinishedItem: FinishedTranscriptItem = {
          id: Date.now().toString(), 
          fileName: fileInfoForProcessing?.fileName || "Unknown File",
          transcriptText: result.transcript,
          segments: result.segments,
          timestamp: Date.now()
        };
        setFinishedTranscripts(prev => [newFinishedItem, ...prev.slice(0, 9)]); 

        const successStateToSave: PersistentTranscriberState = {
            currentProcessingFile: fileInfoForProcessing,
            currentTranscriptText: result.transcript,
            currentSegments: result.segments,
            currentStatusMessage: completeMsg,
            currentErrorMessage: null,
            wasTranscribing: false,
        };
        localStorage.setItem(CURRENT_STATE_LOCAL_STORAGE_KEY, JSON.stringify(successStateToSave));
      } else {
        throw new Error("Received invalid transcription data from backend.");
      }
    } catch (err: any) {
      console.error('Transcription process error:', err);
      setErrorMessage(err.message || 'An unknown error occurred.');
      setStatusMessage(null); 
    } finally {
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


  return (
    <div className="space-y-6 p-1 sm:p-0">
      {/* File Upload Section */}
      <div 
        className={cn(
          "flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors",
          displayFileInfoForCurrent ? "border-primary/50 bg-muted/20" : "border-border hover:bg-muted/20"
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
        <p id="audio-upload-label" className="text-sm text-center text-muted-foreground"> {/* Added text-center */}
          <span className="font-semibold text-primary">Click to upload</span> or drag and drop <br className="sm:hidden"/>MP3, MP4, WAV, M4A, WEBM, etc. {/* Combined lines and added MP4 */}
        </p>
      </div>

      {/* Current/Selected File Info */}
      {displayFileInfoForCurrent && (
        <div className="p-3 border rounded-md bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="truncate">
                <p className="text-sm font-medium text-foreground truncate" title={displayFileInfoForCurrent.fileName || undefined}>{displayFileInfoForCurrent.fileName}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(displayFileInfoForCurrent.fileSize)}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={clearCurrentProcessingStateUI} className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Clear selected file and current process">
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Status/Error Messages for Current Operation */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      
      {statusMessage && !errorMessage && (
        <Alert 
            variant={((currentRawTranscriptText !== null || (currentTranscriptSegments && currentTranscriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded"))) ? "default" : "default"}
            className={cn(
              ((currentRawTranscriptText !== null || (currentTranscriptSegments && currentTranscriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded")))
                ? "border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-900/30"
                : statusMessage.startsWith("Processing")
                  ? "border-blue-500 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30"
                  : "border-border"
            )}
        >
           <AlertTitle className={cn(
             ((currentRawTranscriptText !== null || (currentTranscriptSegments && currentTranscriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded"))) && "text-green-800 dark:text-green-300",
             statusMessage.startsWith("Processing") && "text-blue-800 dark:text-blue-300"
           )}>
             {((currentRawTranscriptText !== null || (currentTranscriptSegments && currentTranscriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded"))) ? "Success!" : "Status"}
           </AlertTitle>
          <AlertDescription className={cn(
             ((currentRawTranscriptText !== null || (currentTranscriptSegments && currentTranscriptSegments.length > 0)) && (statusMessage.includes("complete") || statusMessage.includes("loaded"))) && "text-green-700 dark:text-green-400",
             statusMessage.startsWith("Processing") && "text-blue-700 dark:text-blue-400"
          )}>
            {statusMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Progress Bar */}
      {isTranscribing && (
        <div className="mt-3 mb-1">
          <Progress value={estimatedProgress} className="w-full h-2" />
          <p className="text-xs text-muted-foreground text-center mt-1">
            {statusMessage === "Uploading to secure storage..."
              ? `Uploading: ${Math.floor(estimatedProgress)}%`
              : statusMessage?.includes("complete")
                ? "Complete"
                : "Processing..."
            }
          </p>
        </div>
      )}

      {/* Action Buttons for Current Operation */}
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

        {canDownloadCurrent && (
          <Button
            onClick={handleDownloadCurrentTranscript}
            variant="outline"
            className="w-full sm:flex-1"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Transcript
          </Button>
        )}
      </div>

      {/* Finished Transcripts List */}
      {finishedTranscripts.length > 0 && (
        <div className="mt-8 pt-6 border-t">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-medium text-foreground">Completed Transcripts</h3>
            <Button variant="outline" size="sm" onClick={clearAllFinishedTranscripts}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear List
            </Button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2"> 
            {finishedTranscripts.map((item) => (
              <div key={item.id} className="p-3 border rounded-md bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <ListCollapse className="w-5 h-5 text-primary flex-shrink-0" /> 
                    <div className="truncate">
                      <p className="text-sm font-medium text-foreground truncate" title={item.fileName}>{item.fileName}</p>
                      <p className="text-xs text-muted-foreground">Transcribed: {new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => downloadSpecificTranscript(item)} className="h-7 w-7 text-muted-foreground hover:text-primary" aria-label={`Download ${item.fileName}`}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeFinishedTranscript(item.id)} className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Remove ${item.fileName} from list`}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FullFileTranscriber;
