"use client";
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import PaymentMethodsManagement from '@/components/admin/payment-methods-management';
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PaymentMethod = {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;                              
  createdAt?: string;
  updatedAt?: string;
  details: PaymentMethodDetail[];
};

type PaymentMethodDetail = {
  id: number;
  paymentMethodId: number;  
  key: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
};

// API Response types to handle schema variations
interface PaymentMethodApiResponse {
  id: number;
  name: string;
  description?: string;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

interface PaymentMethodDetailApiResponse {
  id: number;
  paymentMethodId?: number;
  payment_method_id?: number;
  key: string;
  value: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}


const PaymentMethodsPage = () => {
  const router = useRouter();
  const [allMethods, setAllMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchAllMethods();
  }, []);


  // Normalize API response to match our interface
  const normalizePaymentMethod = (apiMethod: PaymentMethodApiResponse): Omit<PaymentMethod, 'details'> => ({
    id: apiMethod.id,
    name: apiMethod.name,
    description: apiMethod.description,
    isActive: apiMethod.isActive !== undefined ? apiMethod.isActive : apiMethod.is_active !== undefined ? apiMethod.is_active : true,
    createdAt: apiMethod.createdAt || apiMethod.created_at,
    updatedAt: apiMethod.updatedAt || apiMethod.updated_at,
  });

  const normalizePaymentMethodDetail = (apiDetail: PaymentMethodDetailApiResponse): PaymentMethodDetail => ({
    id: apiDetail.id,
    paymentMethodId: apiDetail.paymentMethodId || apiDetail.payment_method_id || 0,
    key: apiDetail.key,
    value: apiDetail.value,
    createdAt: apiDetail.createdAt || apiDetail.created_at,
    updatedAt: apiDetail.updatedAt || apiDetail.updated_at,
  });

  async function fetchAllMethods() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payment-methods', {
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to fetch payment methods');

      const data: PaymentMethodApiResponse[] = await res.json();

      // Fetch details for each method and normalize
      const methodsWithDetails = await Promise.all(
        data.map(async (apiMethod: PaymentMethodApiResponse) => {
          try {
            const detailsRes = await fetch(`/api/admin/payment-methods/details?paymentMethodId=${apiMethod.id}`, {
              credentials: 'include',
            });
            const apiDetails: PaymentMethodDetailApiResponse[] = await detailsRes.json();

            const normalizedMethod = normalizePaymentMethod(apiMethod);
            const normalizedDetails = apiDetails.map(normalizePaymentMethodDetail);

            return {
              ...normalizedMethod,
              details: normalizedDetails,
            } as PaymentMethod;
          } catch {
            return {
              ...normalizePaymentMethod(apiMethod),
              details: [],
            } as PaymentMethod;
          }
        })
      );

      setAllMethods(methodsWithDetails);
    } catch (e) {
      setError('Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  }

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  if (loading) {
    return <div className="text-center py-8">Loading payment methods...</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Manage Payment Methods</h1>
        <p className="text-muted-foreground">
          View and manage payment methods and their details
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Methods ({allMethods.length})</CardTitle>
              <CardDescription>
                Manage all payment methods and their details
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-red-600 mb-4">{error}</div>
          )}
          
          <PaymentMethodsManagement
            allMethods={allMethods}
            search={search}
            onSearchChange={handleSearchChange}
            onRefresh={fetchAllMethods}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentMethodsPage;
