  "use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Download, Search } from "lucide-react";

interface LogEntry {
  id: number;
  userId: number | null;
  userEmail: string;
  locationId: string | null;
  action: string;
  details: any;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

export default function LogReportsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    action: "",
    userEmail: "",
    dateFrom: "",
    dateTo: "",
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  const fetchLogs = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (filters.action && filters.action !== "all") queryParams.append("action", filters.action);
      if (filters.userEmail) queryParams.append("userEmail", filters.userEmail);
      if (filters.dateFrom) queryParams.append("dateFrom", filters.dateFrom);
      if (filters.dateTo) queryParams.append("dateTo", filters.dateTo);

      const response = await fetch(`/api/admin/log-reports?${queryParams}`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch logs",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch logs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (filters.action && filters.action !== "all") queryParams.append("action", filters.action);
      if (filters.userEmail) queryParams.append("userEmail", filters.userEmail);
      if (filters.dateFrom) queryParams.append("dateFrom", filters.dateFrom);
      if (filters.dateTo) queryParams.append("dateTo", filters.dateTo);

      const response = await fetch(`/api/admin/log-reports/export?${queryParams}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        toast({
          title: "Error",
          description: "Failed to export logs",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export logs",
        variant: "destructive",
      });
    }
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action.toLowerCase()) {
      case "login":
        return "default";
      case "logout":
        return "secondary";
      case "create":
        return "default";
      case "update":
        return "outline";
      case "delete":
        return "destructive";
      case "merge_contacts":
      case "mergecontacts":
      case "MERGE_CONTACTS":
        return "outline";
      default:
        return "secondary";
    }
  };

const formatDetails = (action: string, detailsStr: string | null) => {
    if (!detailsStr) return "No details";
    
    try {
      const details = typeof detailsStr === "string" ? JSON.parse(detailsStr) : detailsStr;
      
      // Category actions: show name and ID
      if (action.startsWith("category_") && details?.name && details?.entityId) {
        return `Category "${details.name}" #${details.entityId}`;
      }
      
      if (action === "MERGE_CONTACTS") {
        let sourceInfo = "N/A";
        if (details.sourceContacts && Array.isArray(details.sourceContacts) && details.sourceContacts.length > 0) {
          sourceInfo = details.sourceContacts.map((c: any) => 
            `#${c.id} (${c.displayName || 'Unnamed'})`
          ).join(' + ');
        } else if (Array.isArray(details.sourceContactIds)) {
          sourceInfo = `[${details.sourceContactIds.join(', ')}]`;
        }
        
        const targetId = details.targetContactId || details.targetContact?.id || "N/A";
        const targetName = details.targetContact?.displayName || details.displayName || "Unnamed";
        const targetEmail = details.targetContact?.email || details.email || "No email";
        
        return `${sourceInfo} merged into #${targetId}: ${targetName} (${targetEmail})`;
      }
      
      // Other actions: try to show key info
      if (typeof details === "object") {
        if (details.entity && details.entityId) {
          return `${details.entity} #${details.entityId}`;
        }
        if (details.action === "manual_donation_add") {
          return `Manual Donation #${details.entityId || 'N/A'} ($${details.amount}) to Contact #${details.contactId}`;
        }
        if (details.contactId) {
          if (details.changedFields && details.changedFields.length > 0) {
            const userChanges = details.changedFields.filter((change: any) => 
              change.field !== 'updatedAt'
            ).map((change: any) => 
              `${change.field}: "${change.old || ''}" → "${change.new || ''}"`
            ).join('; ');
            return `Contact #${details.contactId}: ${userChanges || 'No user fields changed'}`;
          }
          return `Contact #${details.contactId} (${details.contactName || 'N/A'})`;
        }
        if (details.pledgeId) {
          return `Pledge #${details.pledgeId} ($${details.originalAmount || details.amount})`;
        }
        return Object.entries(details)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
      }
      
      return detailsStr;
    } catch (e) {
      return detailsStr;
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Audit Log Reports</h1>
        <Button onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Action</label>
              <Select value={filters.action} onValueChange={(value) => setFilters({ ...filters, action: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="MERGE_CONTACTS">Merge Contacts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">User Email</label>
              <Input
                placeholder="Search by email"
                value={filters.userEmail}
                onChange={(e) => setFilters({ ...filters, userEmail: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">From Date</label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Date</label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell>
                  <TableCell>{log.userEmail}</TableCell>
                  <TableCell>
                    <Badge variant={getActionBadgeVariant(log.action)}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-lg font-mono text-sm" title={JSON.stringify(log.details) ?? "No details"}>
                    {formatDetails(log.action, log.details)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {logs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No logs found matching the current filters.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
