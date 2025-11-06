"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Users, AlertTriangle, DollarSign, CreditCard, HandCoins } from "lucide-react";
import { useGetContacts } from "@/lib/query/useContacts";
import { useMergeContacts } from "../../../lib/mutation/useMergeContacts";
import { useToast } from "@/hooks/use-toast";
import { useQueries } from "@tanstack/react-query";

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

  // Fetch detailed data for selected contacts
  const detailedQueries = useQueries({
    queries: selectedContacts.flatMap(contactId => [
      {
        queryKey: ['pledges', contactId],
        queryFn: () => fetch(`/api/pledges?contactId=${contactId}`).then(res => res.json()),
        enabled: selectedContacts.length > 0,
      },
      {
        queryKey: ['payments', contactId],
        queryFn: () => fetch(`/api/payments?contactId=${contactId}`).then(res => res.json()),
        enabled: selectedContacts.length > 0,
      },
      {
        queryKey: ['manual-donations', contactId],
        queryFn: () => fetch(`/api/manual-donations?contactId=${contactId}`).then(res => res.json()),
        enabled: selectedContacts.length > 0,
      },
    ]),
  });

  const getQueryData = (contactId: number, type: 'pledges' | 'payments' | 'manual-donations') => {
    const index = selectedContacts.indexOf(contactId);
    if (index === -1) return { data: [], isLoading: false };
    const queryIndex = index * 3 + (type === 'pledges' ? 0 : type === 'payments' ? 1 : 2);
    return detailedQueries[queryIndex] || { data: [], isLoading: false };
  };

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

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Selected Contacts ({selectedContacts.length})</h4>
                  <div className="space-y-2">
                    {selectedContactDetails.map(contact => (
                      <div key={contact.id} className="p-3 border rounded-lg bg-muted/50">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">
                              {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                              {contact.id === targetContactId && " (Target)"}
                            </div>
                            <div className="text-sm text-muted-foreground">{contact.email}</div>
                          </div>
                          <div className="text-right text-sm">
                            <div>Pledges: ${(Number(contact.totalPledgedUsd) || 0).toFixed(2)}</div>
                            <div>Payments: ${(Number(contact.totalPaidUsd) || 0).toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Total pledges to merge: ${totalPledges.toFixed(2)}<br />
                    Total payments to merge: ${totalPayments.toFixed(2)}
                  </AlertDescription>
                </Alert>
              </div>

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

      {/* Confirmation Dialog - Fixed with scrollable content */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-h-[90vh] flex flex-col max-w-3xl">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm Merge
            </DialogTitle>
          </DialogHeader>
          
          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. All selected contacts will be merged into the target contact.
                Source contacts will be permanently deleted.
              </AlertDescription>
            </Alert>

            {/* Summary Section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg bg-muted/50">
                <h4 className="font-medium mb-2">Final Contact Details</h4>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{displayName}</span></p>
                  <p><span className="text-muted-foreground">Email:</span> <span className="font-medium">{email}</span></p>
                </div>
              </div>

              <div className="p-4 border rounded-lg bg-muted/50">
                <h4 className="font-medium mb-2">Contacts to Merge</h4>
                <div className="space-y-1 text-sm">
                  {selectedContactDetails.map(contact => (
                    <div key={contact.id} className="flex items-center gap-2">
                      <span className={contact.id === targetContactId ? "font-medium" : ""}>
                        {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                      </span>
                      {contact.id === targetContactId && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">Target</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Financial Details by Contact */}
            <div>
              <h4 className="font-medium mb-3">Financial Details by Contact</h4>
              <div className="space-y-3">
                {selectedContactDetails.map((contact) => {
                  const pledgesQuery = getQueryData(contact.id, 'pledges');
                  const paymentsQuery = getQueryData(contact.id, 'payments');
                  const manualDonationsQuery = getQueryData(contact.id, 'manual-donations');

                  const pledges = pledgesQuery.data?.pledges || [];
                  const payments = paymentsQuery.data?.payments || [];
                  const manualDonations = manualDonationsQuery.data?.manualDonations || [];

                  const totalContactPledges = pledges.reduce((sum: number, p: any) => sum + (Number(p.originalAmountUsd) || 0), 0);
                  const totalContactPayments = payments.reduce((sum: number, p: any) => sum + (Number(p.amountUsd) || 0), 0);
                  const totalContactManual = manualDonations.reduce((sum: number, d: any) => sum + (Number(d.amountUsd) || 0), 0);

                  return (
                    <div key={contact.id} className="border rounded-lg p-4 bg-card">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="font-medium flex items-center gap-2">
                          {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                          {contact.id === targetContactId && (
                            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">Target</span>
                          )}
                        </h5>
                        <div className="text-sm font-medium">
                          Total: ${(totalContactPayments + totalContactManual).toFixed(2)}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {/* Pledges */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <DollarSign className="h-4 w-4" />
                            <span>Pledges ({pledges.length})</span>
                          </div>
                          {pledgesQuery.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading...</p>
                          ) : pledges.length > 0 ? (
                            <div className="space-y-1">
                              {pledges.map((pledge: any) => (
                                <div key={pledge.id} className="text-xs p-2 bg-muted/50 rounded">
                                  <div className="font-medium">${(Number(pledge.originalAmountUsd) || 0).toFixed(2)}</div>
                                  <div className="text-muted-foreground">{pledge.pledgeDate}</div>
                                </div>
                              ))}
                              <div className="text-xs font-medium pt-1 border-t">
                                Subtotal: ${totalContactPledges.toFixed(2)}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">None</p>
                          )}
                        </div>

                        {/* Payments */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <CreditCard className="h-4 w-4" />
                            <span>Payments ({payments.length})</span>
                          </div>
                          {paymentsQuery.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading...</p>
                          ) : payments.length > 0 ? (
                            <div className="space-y-1">
                              {payments.map((payment: any) => (
                                <div key={payment.id} className="text-xs p-2 bg-muted/50 rounded">
                                  <div className="font-medium">${(Number(payment.amountUsd) || 0).toFixed(2)}</div>
                                  <div className="text-muted-foreground">{payment.paymentDate}</div>
                                </div>
                              ))}
                              <div className="text-xs font-medium pt-1 border-t">
                                Subtotal: ${totalContactPayments.toFixed(2)}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">None</p>
                          )}
                        </div>

                        {/* Manual Donations */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <HandCoins className="h-4 w-4" />
                            <span>Manual ({manualDonations.length})</span>
                          </div>
                          {manualDonationsQuery.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading...</p>
                          ) : manualDonations.length > 0 ? (
                            <div className="space-y-1">
                              {manualDonations.map((donation: any) => (
                                <div key={donation.id} className="text-xs p-2 bg-muted/50 rounded">
                                  <div className="font-medium">${(Number(donation.amountUsd) || 0).toFixed(2)}</div>
                                  <div className="text-muted-foreground">{donation.paymentDate}</div>
                                </div>
                              ))}
                              <div className="text-xs font-medium pt-1 border-t">
                                Subtotal: ${totalContactManual.toFixed(2)}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">None</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-shrink-0 border-t pt-4">
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