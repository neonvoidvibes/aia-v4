"use client";

import React, { useState, useRef, useCallback } from 'react';
import { UploadCloud, FileText, Loader2, Download, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from '@/lib/utils';

const FullFileTranscriber: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearSelection = () => {
    setSelectedFile(null);
    setTranscriptText(null);
    setStatusMessage(null);
    setErrorMessage(null);
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        setErrorMessage('Invalid file type. Please select an audio file.');
        setSelectedFile(null);
        return;
      }
      clearSelection(); // Clear previous state before setting new file
      setSelectedFile(file);
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
      clearSelection(); // Clear previous state before setting new file
      setSelectedFile(file);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleStartTranscription = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select an audio file first.');
      return;
    }

    setIsTranscribing(true);
    setStatusMessage(`Processing: ${selectedFile.name}... This may take a few moments.`);
    setErrorMessage(null);
    setTranscriptText(null);

    const formData = new FormData();
    formData.append('audio_file', selectedFile);

    try {
      const response = await fetch('/api/transcribe-audio', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || `Transcription failed with status ${response.status}`);
      }

      setTranscriptText(data.transcript);
      setStatusMessage('Transcription complete!');
    } catch (err: any) {
      console.error('Transcription error:', err);
      setErrorMessage(err.message || 'An unknown error occurred during transcription.');
      setStatusMessage(null);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleDownloadTranscript = () => {
    if (!transcriptText || !selectedFile) return;

    const blob = new Blob([transcriptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) || selectedFile.name;
    link.download = `${baseName}_transcript.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 p-1 sm:p-0"> {/* Reduced padding on small screens */}
      <div
        className={cn(
          "flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors",
          selectedFile ? "border-primary/50 bg-muted/20" : "border-border hover:bg-muted/20"
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

      {selectedFile && (
        <div className="p-3 border rounded-md bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="truncate">
                <p className="text-sm font-medium text-foreground truncate" title={selectedFile.name}>{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
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
        <Alert variant={transcriptText ? "default" : "default"} className={cn(transcriptText ? "border-green-500 dark:border-green-600" : "border-blue-500 dark:border-blue-600")}>
          <AlertTitle>{transcriptText ? "Success!" : "Status"}</AlertTitle>
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          onClick={handleStartTranscription}
          disabled={!selectedFile || isTranscribing}
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

        {transcriptText && (
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