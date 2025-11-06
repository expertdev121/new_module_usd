"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Users, AlertTriangle } from "lucide-react";
import { useGetContacts } from "@/lib/query/useContacts";
import { useMergeContacts } from "../../../lib/mutation/useMergeContacts";
import { useToast } from "@/hooks/use-toast";

export default function MergeContactsPage() {
  const [search, setSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [targetContactId, setTargetContactId] = useState<number | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const { toast } = useToast();

  const { data: contactsData, isLoading } = useGetContacts({
    page: 1,
    limit: 50,
    sortBy: "displayName",
    sortOrder: "asc",
    search: search || undefined,
  });
  const mergeContactsMutation = useMergeContacts();

  const contacts = contactsData?.contacts || [];

  const selectedContactDetails = useMemo(() => {
    return contacts.filter(contact => selectedContacts.includes(contact.id));
  }, [contacts, selectedContacts]);

  const targetContact = useMemo(() => {
    return contacts.find(contact => contact.id === targetContactId);
  }, [contacts, targetContactId]);

  const handleContactSelect = (contactId: number, checked: boolean) => {
    if (checked) {
      setSelectedContacts(prev => [...prev, contactId]);
    } else {
      setSelectedContacts(prev => prev.filter(id => id !== contactId));
      if (targetContactId === contactId) {
        setTargetContactId(null);
      }
    }
  };

  const handleSetAsTarget = (contactId: number) => {
    setTargetContactId(contactId);
    const contact = contacts.find(c => c.id === contactId);
    setDisplayName(contact?.displayName || `${contact?.firstName} ${contact?.lastName}` || "");
    setEmail(contact?.email || "");
  };

  const handleMergeSubmit = () => {
    if (selectedContacts.length < 2) {
      toast({
        title: "Error",
        description: "Please select at least two contacts to merge",
        variant: "destructive",
      });
      return;
    }

    if (!targetContactId) {
      toast({
        title: "Error",
        description: "Please select a target contact",
        variant: "destructive",
      });
      return;
    }

    setShowConfirmDialog(true);
  };

  const handleConfirmMerge = () => {
    const data = {
      sourceContactIds: selectedContacts.filter(id => id !== targetContactId),
      targetContactId: targetContactId!,
      displayName,
      email,
    };

    mergeContactsMutation.mutate(data, {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Contacts merged successfully",
        });
        setSelectedContacts([]);
        setTargetContactId(null);
        setShowConfirmDialog(false);
        setSearch("");
        setDisplayName("");
        setEmail("");
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to merge contacts",
          variant: "destructive",
        });
      },
    });
  };

  const totalPledges = selectedContactDetails.reduce((sum, contact) => sum + (Number(contact.totalPledgedUsd) || 0), 0);
  const totalPayments = selectedContactDetails.reduce((sum, contact) => sum + (Number(contact.totalPaidUsd) || 0), 0);

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Merge Contacts</h1>
        <p className="text-muted-foreground">
          Select multiple contacts to merge into one. All related data will be transferred to the target contact.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Select Contacts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search contacts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2">
                {isLoading ? (
                  <div className="text-center py-4">Loading contacts...</div>
                ) : contacts.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No contacts found</div>
                ) : (
                  contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center space-x-3 p-3 border rounded-lg">
                      <Checkbox
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={(checked) => handleContactSelect(contact.id, checked as boolean)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                        </div>
                        <div className="text-sm text-muted-foreground">{contact.email}</div>
                      </div>
                      {selectedContacts.includes(contact.id) && (
                        <Button
                          variant={targetContactId === contact.id ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleSetAsTarget(contact.id)}
                        >
                          {targetContactId === contact.id ? "Target" : "Set as Target"}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Merge Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Merge Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Display Name</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter display name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="Enter email"
                />
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Selected contacts: {selectedContacts.length}<br />
                  Target contact: {targetContact ? (targetContact.displayName || `${targetContact.firstName} ${targetContact.lastName}`) : "None"}<br />
                  Total pledges to merge: ${totalPledges.toFixed(2)}<br />
                  Total payments to merge: ${totalPayments.toFixed(2)}
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleMergeSubmit}
                disabled={selectedContacts.length < 2 || !targetContactId}
                className="w-full"
              >
                Merge Contacts
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm Merge
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. All selected contacts will be merged into the target contact.
                Source contacts will be permanently deleted.
              </AlertDescription>
            </Alert>

            <div>
              <h4 className="font-medium mb-2">Contacts to merge:</h4>
              <ul className="list-disc list-inside space-y-1">
                {selectedContactDetails.map(contact => (
                  <li key={contact.id}>
                    {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                    {contact.id === targetContactId && " (Target)"}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">Final contact details:</h4>
              <p><strong>Display Name:</strong> {displayName}</p>
              <p><strong>Email:</strong> {email}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmMerge}
              disabled={mergeContactsMutation.isPending}
            >
              {mergeContactsMutation.isPending ? "Merging..." : "Confirm Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
