"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsersTable } from "@/components/admin/users-table";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search } from "lucide-react";
import { ChevronLeft, ChevronRight, Plus, UserPlus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  email: string;
  role: "admin" | "user";
  status: "active" | "suspended";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState<"user" | "admin">("user");
  const [addLoading, setAddLoading] = useState(false);
  const { toast } = useToast();

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail || !addPassword) return;
    setAddLoading(true);
    try {
      const response = await fetch("/api/admin/add-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: addEmail, password: addPassword, role: addRole }),
      });
      if (response.ok) {
        toast({ title: "Success", description: "User created successfully" });
        setShowAddForm(false);
        setAddEmail("");
        setAddPassword("");
        setAddRole("user");
        fetchUsers(); // Refresh list
      } else {
        const data = await response.json();
        toast({ title: "Error", description: data.error || "Failed to create user", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setAddLoading(false);
    }
  };

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
    } else if (session.user.role !== "admin") {
      router.push("/contacts");
    } else {
      fetchUsers();
    }
  }, [session, status, router, currentPage, searchQuery]);

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
        search: searchQuery,
      });
      const response = await fetch(`/api/admin/users?${params}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setTotalCount(data.pagination.totalCount);
        setTotalPages(data.pagination.totalPages);
      } else {
        setError("Failed to fetch users");
      }
    } catch (err) {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1); // Reset to first page when searching
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  if (status === "loading" || loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null; // Will redirect
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Manage Users</h1>
        <p className="text-muted-foreground">
          View and manage all user accounts
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <CardTitle>Users ({totalCount})</CardTitle>
              <CardDescription>
                Manage user accounts, roles, and status
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? "destructive" : "default"}>
              {showAddForm ? (
                <>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add New User
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <form onSubmit={handleAddUser} className="space-y-4 mb-6 p-6 border rounded-lg bg-muted/50">
              <h3 className="font-semibold text-lg">Add New User</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="addEmail">Email</Label>
                  <Input
                    id="addEmail"
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="addPassword">Password</Label>
                  <Input
                    id="addPassword"
                    type="password"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="addRole">Role</Label>
                  <Select value={addRole} onValueChange={(value: "user" | "admin") => setAddRole(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full md:w-auto" disabled={addLoading}>
                {addLoading ? "Creating..." : "Create User"}
              </Button>
            </form>
          )}
          <div className="flex items-center space-x-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          {error && (
            <div className="text-red-600 mb-4">{error}</div>
          )}
          <UsersTable users={users} onUserUpdate={fetchUsers} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} users
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
