"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, File } from "lucide-react";

interface DownloadButtonsProps {
  onCsvDownload: () => Promise<void>;
  onPdfDownload: () => Promise<void>;
  csvLoading?: boolean;
  pdfLoading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DownloadButtons({
  onCsvDownload,
  onPdfDownload,
  csvLoading = false,
  pdfLoading = false,
  disabled = false,
  className = "",
}: DownloadButtonsProps) {
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const handleCsvDownload = async () => {
    setCsvDownloading(true);
    try {
      await onCsvDownload();
    } finally {
      setCsvDownloading(false);
    }
  };

  const handlePdfDownload = async () => {
    setPdfDownloading(true);
    try {
      await onPdfDownload();
    } finally {
      setPdfDownloading(false);
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <Button
        onClick={handleCsvDownload}
        disabled={disabled || csvLoading || csvDownloading || pdfDownloading}
        variant="default"
        size="sm"
        className="flex items-center bg-green-600 hover:bg-green-700 text-white border-green-600"
      >
        {csvDownloading || csvLoading ? (
          <svg
            className="animate-spin mr-2 h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            ></path>
          </svg>
        ) : (
          <FileText className="mr-2 h-4 w-4" />
        )}
        Download CSV
      </Button>

      <Button
        onClick={handlePdfDownload}
        disabled={disabled || pdfLoading || pdfDownloading || csvDownloading}
        variant="default"
        size="sm"
        className="flex items-center bg-red-600 hover:bg-red-700 text-white border-red-600"
      >
        {pdfDownloading || pdfLoading ? (
          <svg
            className="animate-spin mr-2 h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            ></path>
          </svg>
        ) : (
          <File className="mr-2 h-4 w-4" />
        )}
        Download PDF
      </Button>
    </div>
  );
}
