"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Target, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useCampaigns, useMergeCampaigns } from "@/lib/query/useCampaigns";
import { useToast } from "@/hooks/use-toast";

export default function CampaignMergePage() {
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [targetCampaignId, setTargetCampaignId] = useState<string>("");
  const { data: campaigns, isLoading, error } = useCampaigns();
  const mergeCampaignsMutation = useMergeCampaigns();
  const { toast } = useToast();

  const availableCampaigns = campaigns || [];

  const handleSourceToggle = (campaignId: number, checked: boolean) => {
    if (checked) {
      setSelectedSourceIds(prev => [...prev, campaignId]);
    } else {
      setSelectedSourceIds(prev => prev.filter(id => id !== campaignId));
    }
  };

  const handleMerge = async () => {
    if (selectedSourceIds.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one source campaign to merge.",
        variant: "destructive",
      });
      return;
    }

    if (!targetCampaignId) {
      toast({
        title: "Error",
        description: "Please select a target campaign.",
        variant: "destructive",
      });
      return;
    }

    const targetId = parseInt(targetCampaignId);
    if (selectedSourceIds.includes(targetId)) {
      toast({
        title: "Error",
        description: "Target campaign cannot be in the source campaigns list.",
        variant: "destructive",
      });
      return;
    }

    try {
      await mergeCampaignsMutation.mutateAsync({
        sourceCampaignIds: selectedSourceIds,
        targetCampaignId: targetId,
      });

      toast({
        title: "Success",
        description: `Successfully merged ${selectedSourceIds.length} campaigns.`,
      });

      // Reset form
      setSelectedSourceIds([]);
      setTargetCampaignId("");
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to merge campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "completed":
        return "outline";
      default:
        return "secondary";
    }
  };

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center py-8">
          <p className="text-red-500">Error loading campaigns: {error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild>
          <Link href="/admin/campaigns">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Campaigns
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Merge Campaigns</h1>
          <p className="text-muted-foreground">
            Select multiple campaigns to merge into one target campaign
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Campaign Merge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <h3 className="font-medium text-yellow-800">Important Warning</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  Merging campaigns is irreversible. Source campaigns will be permanently deleted,
                  and all associated manual donations will be reassigned to the target campaign.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Source Campaigns Selection */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-3">Source Campaigns (to be merged)</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select the campaigns you want to merge. These will be deleted after merging.
                </p>
              </div>

              {isLoading ? (
                <div className="text-center py-8">Loading campaigns...</div>
              ) : availableCampaigns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No campaigns available.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableCampaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50"
                    >
                      <Checkbox
                        id={`source-${campaign.id}`}
                        checked={selectedSourceIds.includes(campaign.id)}
                        onCheckedChange={(checked) =>
                          handleSourceToggle(campaign.id, checked as boolean)
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <label
                          htmlFor={`source-${campaign.id}`}
                          className="text-sm font-medium cursor-pointer"
                        >
                          {campaign.name}
                        </label>
                        <p className="text-xs text-muted-foreground truncate">
                          {campaign.description || "No description"}
                        </p>
                      </div>
                      <Badge variant={getStatusBadgeVariant(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Target Campaign Selection */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-3">Target Campaign (to keep)</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select the campaign that will remain after merging.
                </p>
              </div>

              <div className="space-y-3">
                <Select value={targetCampaignId} onValueChange={setTargetCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose target campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCampaigns.map((campaign) => (
                      <SelectItem
                        key={campaign.id}
                        value={campaign.id.toString()}
                        disabled={selectedSourceIds.includes(campaign.id)}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{campaign.name}</span>
                          <Badge variant={getStatusBadgeVariant(campaign.status)} className="ml-2">
                            {campaign.status}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {targetCampaignId && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">Selected Target:</p>
                    <p className="text-sm text-blue-700">
                      {availableCampaigns.find(c => c.id.toString() === targetCampaignId)?.name}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Merge Summary */}
          {(selectedSourceIds.length > 0 || targetCampaignId) && (
            <div className="bg-gray-50 border rounded-lg p-4">
              <h4 className="font-medium mb-2">Merge Summary</h4>
              <div className="text-sm space-y-1">
                <p><strong>Source campaigns:</strong> {selectedSourceIds.length}</p>
                <p><strong>Target campaign:</strong> {
                  targetCampaignId
                    ? availableCampaigns.find(c => c.id.toString() === targetCampaignId)?.name
                    : "Not selected"
                }</p>
                <p className="text-muted-foreground">
                  All manual donations from source campaigns will be reassigned to the target campaign.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" asChild>
              <Link href="/admin/campaigns">Cancel</Link>
            </Button>
            <Button
              onClick={handleMerge}
              disabled={mergeCampaignsMutation.isPending || selectedSourceIds.length === 0 || !targetCampaignId}
            >
              {mergeCampaignsMutation.isPending ? "Merging..." : "Merge Campaigns"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
