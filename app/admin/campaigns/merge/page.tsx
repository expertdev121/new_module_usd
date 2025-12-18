"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Target, AlertTriangle, Search, X } from "lucide-react";
import Link from "next/link";
import { useCampaigns, useMergeCampaigns } from "@/lib/query/useCampaigns";
import { useToast } from "@/hooks/use-toast";

export default function CampaignMergePage() {
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [targetCampaignId, setTargetCampaignId] = useState<number | null>(null);
  const [sourceSearchQuery, setSourceSearchQuery] = useState("");
  const [targetSearchQuery, setTargetSearchQuery] = useState("");
  const { data: campaigns, isLoading, error } = useCampaigns();
  const mergeCampaignsMutation = useMergeCampaigns();
  const { toast } = useToast();

  // Sort campaigns alphabetically
  const sortedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return [...campaigns].sort((a, b) => a.name.localeCompare(b.name));
  }, [campaigns]);

  // Filter source campaigns (don't exclude target)
  const filteredSourceCampaigns = useMemo(() => {
    return sortedCampaigns.filter(campaign => {
      const matchesSearch = campaign.name.toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
                           campaign.description?.toLowerCase().includes(sourceSearchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [sortedCampaigns, sourceSearchQuery]);

  // Filter target campaigns (only show selected source campaigns)
  const filteredTargetCampaigns = useMemo(() => {
    // Only show campaigns that are selected as sources
    return sortedCampaigns.filter(campaign => {
      const isSelectedAsSource = selectedSourceIds.includes(campaign.id);
      const matchesSearch = campaign.name.toLowerCase().includes(targetSearchQuery.toLowerCase()) ||
                           campaign.description?.toLowerCase().includes(targetSearchQuery.toLowerCase());
      return isSelectedAsSource && matchesSearch;
    });
  }, [sortedCampaigns, targetSearchQuery, selectedSourceIds]);

  const handleSourceToggle = (campaignId: number, checked: boolean) => {
    if (checked) {
      setSelectedSourceIds(prev => [...prev, campaignId]);
    } else {
      setSelectedSourceIds(prev => prev.filter(id => id !== campaignId));
    }
  };

  const handleTargetSelect = (campaignId: number) => {
    setTargetCampaignId(campaignId);
    setTargetSearchQuery(""); // Clear search after selection
  };

  const clearTargetSelection = () => {
    setTargetCampaignId(null);
    setTargetSearchQuery("");
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

    try {
      const result = await mergeCampaignsMutation.mutateAsync({
        sourceCampaignIds: selectedSourceIds,
        targetCampaignId: targetCampaignId,
      });

      toast({
        title: "Success",
        description: result.message || `Successfully merged ${selectedSourceIds.length} campaigns.`,
      });

      // Reset form
      setSelectedSourceIds([]);
      setTargetCampaignId(null);
      setSourceSearchQuery("");
      setTargetSearchQuery("");
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

  const selectedTargetCampaign = targetCampaignId 
    ? sortedCampaigns.find(c => c.id === targetCampaignId)
    : null;

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

              {/* Source Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search campaigns..."
                  value={sourceSearchQuery}
                  onChange={(e) => setSourceSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {isLoading ? (
                <div className="text-center py-8">Loading campaigns...</div>
              ) : filteredSourceCampaigns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {sourceSearchQuery ? "No campaigns found matching your search." : "No campaigns available."}
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto border rounded-lg p-2">
                  {filteredSourceCampaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors"
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
                          className="text-sm font-medium cursor-pointer block"
                        >
                          {campaign.name}
                        </label>
                        {campaign.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {campaign.description}
                          </p>
                        )}
                      </div>
                      <Badge variant={getStatusBadgeVariant(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              {selectedSourceIds.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {selectedSourceIds.length} campaign{selectedSourceIds.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>

            {/* Target Campaign Selection */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-3">Target Campaign (to keep)</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select one of the source campaigns to keep as the target.
                </p>
              </div>

              {/* Show selected target or search */}
              {selectedTargetCampaign ? (
                <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-blue-900">
                          {selectedTargetCampaign.name}
                        </p>
                        <Badge variant={getStatusBadgeVariant(selectedTargetCampaign.status)}>
                          {selectedTargetCampaign.status}
                        </Badge>
                      </div>
                      {selectedTargetCampaign.description && (
                        <p className="text-xs text-blue-700">
                          {selectedTargetCampaign.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearTargetSelection}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Target Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Search target campaign..."
                      value={targetSearchQuery}
                      onChange={(e) => setTargetSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {isLoading ? (
                    <div className="text-center py-8">Loading campaigns...</div>
                  ) : selectedSourceIds.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Please select source campaigns first.
                    </div>
                  ) : filteredTargetCampaigns.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {targetSearchQuery ? "No campaigns found matching your search." : "No campaigns available."}
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto border rounded-lg p-2">
                      {filteredTargetCampaigns.map((campaign) => (
                        <div
                          key={campaign.id}
                          className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{campaign.name}</p>
                            {campaign.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {campaign.description}
                              </p>
                            )}
                          </div>
                          <Badge variant={getStatusBadgeVariant(campaign.status)}>
                            {campaign.status}
                          </Badge>
                          <Button
                            size="sm"
                            onClick={() => handleTargetSelect(campaign.id)}
                            className="ml-2"
                          >
                            Set Target
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Merge Summary */}
          {(selectedSourceIds.length > 0 || selectedTargetCampaign) && (
            <div className="bg-gray-50 border rounded-lg p-4">
              <h4 className="font-medium mb-2">Merge Summary</h4>
              <div className="text-sm space-y-1">
                <p><strong>Source campaigns:</strong> {selectedSourceIds.length}</p>
                <p><strong>Target campaign:</strong> {
                  selectedTargetCampaign ? selectedTargetCampaign.name : "Not selected"
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