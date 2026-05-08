"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoriesManagement } from "@/components/admin/categories-management";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Category {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export default function CategoriesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
    } else if (session.user.role !== "admin") {
      router.push("/contacts");
    } else {
      fetchCategories();
    }
  }, [session, status, router, currentPage, pageSize, search]);

  const fetchCategories = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
      });
      if (search) params.append("search", search);

      const response = await fetch(`/api/categories?${params}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories);
        setPagination(data.pagination);
      } else {
        setError("Failed to fetch categories");
      }
    } catch (err) {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (size: string) => {
    setPageSize(Number(size));
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  if (status === "loading" || loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null; // Will redirect
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Manage Categories</h1>
        <p className="text-muted-foreground">
          View and manage categories, items, and groups
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Categories ({pagination?.totalCount || 0})</CardTitle>
              <CardDescription>
                Manage categories, their items, and groups
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show</span>
              <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">per page</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-red-600 mb-4">{error}</div>
          )}
          <CategoriesManagement
            categories={categories}
            onCategoryUpdate={fetchCategories}
            search={search}
            onSearchChange={handleSearchChange}
          />

          {pagination && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, pagination.totalCount)} of {pagination.totalCount} categories
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={!pagination.hasPreviousPage}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={!pagination.hasNextPage}
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
