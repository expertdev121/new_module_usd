/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useMemo } from "react";
import { useQueryState } from "nuqs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Users,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Award,
  Calculator,
  FileText,
  Loader2,
} from "lucide-react";
import {
  useSolicitors,
  useBonusRules,
  usePayments,
  useBonusCalculations,
  useDashboardStats,
  useAssignPayment,
  useUnassignPayment,
  useMarkBonusPaid,
  useRecalculateBonus,
} from "@/lib/query/solicitors/solicitorQueries";

export default function SolicitorDashboard() {
  const [page, setPage] = useQueryState("page", {
    parse: (value) => parseInt(value) || 1,
    serialize: (value) => value.toString(),
  });
  const [limit] = useQueryState("limit", {
    parse: (value) => parseInt(value) || 10,
    serialize: (value) => value.toString(),
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("solicitors");

  const { data: solicitorsData, isLoading: solicitorsLoading } = useSolicitors({
    search: searchTerm,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: bonusRulesData, isLoading: bonusRulesLoading } =
    useBonusRules();

  const { data: assignedPaymentsData, isLoading: assignedPaymentsLoading } =
    usePayments({
      assigned: true,
    });

  const { data: unassignedPaymentsData, isLoading: unassignedPaymentsLoading } =
    usePayments({
      assigned: false,
    });

  const { data: bonusCalculationsData, isLoading: bonusCalculationsLoading } =
    useBonusCalculations();

  const { data: dashboardStatsData, isLoading: statsLoading } =
    useDashboardStats();

  const assignPaymentMutation = useAssignPayment();
  const unassignPaymentMutation = useUnassignPayment();
  const markBonusPaidMutation = useMarkBonusPaid();
  const recalculateBonusMutation = useRecalculateBonus();

  const solicitors = solicitorsData?.solicitors || [];
  const bonusRules = bonusRulesData?.bonusRules || [];
  const assignedPayments = assignedPaymentsData?.payments || [];
  const unassignedPayments = unassignedPaymentsData?.payments || [];
  const bonusCalculations = bonusCalculationsData?.bonusCalculations || [];

  const stats = useMemo(() => {
    if (!dashboardStatsData) {
      return {
        activeSolicitors: 0,
        totalSolicitors: 0,
        totalRaised: 0,
        totalBonuses: 0,
        unpaidBonuses: 0,
        unassignedCount: 0,
        assignedCount: 0,
      };
    }

    return {
      activeSolicitors: dashboardStatsData.solicitors.active,
      totalSolicitors: dashboardStatsData.solicitors.total,
      totalRaised: dashboardStatsData.payments.assignedAmount,
      totalBonuses: dashboardStatsData.bonuses.totalAmount,
      unpaidBonuses: dashboardStatsData.bonuses.unpaidAmount,
      unassignedCount: dashboardStatsData.payments.unassigned,
      assignedCount: dashboardStatsData.payments.assigned,
    };
  }, [dashboardStatsData]);

  const getStatusBadge = (status: string) => {
    const variants = {
      active: "bg-green-100 text-green-800 border-green-200",
      inactive: "bg-gray-100 text-gray-800 border-gray-200",
      suspended: "bg-red-100 text-red-800 border-red-200",
      completed: "bg-green-100 text-green-800 border-green-200",
      pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
      processing: "bg-blue-100 text-blue-800 border-blue-200",
      failed: "bg-red-100 text-red-800 border-red-200",
    };
    return (
      variants[status as keyof typeof variants] ||
      "bg-gray-100 text-gray-800 border-gray-200"
    );
  };

  const handleAssignPayment = async (
    paymentId: number,
    solicitorId: number
  ) => {
    try {
      await assignPaymentMutation.mutateAsync({ paymentId, solicitorId });
    } catch (error) {
      console.error("Failed to assign payment:", error);
    }
  };

  const handleUnassignPayment = async (paymentId: number) => {
    try {
      await unassignPaymentMutation.mutateAsync(paymentId);
    } catch (error) {
      console.error("Failed to unassign payment:", error);
    }
  };

  const handleMarkBonusPaid = async (calculationId: number) => {
    try {
      await markBonusPaidMutation.mutateAsync(calculationId);
    } catch (error) {
      console.error("Failed to mark bonus as paid:", error);
    }
  };

  const handleRecalculateBonus = async (paymentId: number) => {
    try {
      await recalculateBonusMutation.mutateAsync(paymentId);
    } catch (error) {
      console.error("Failed to recalculate bonus:", error);
    }
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Solicitor Management System
        </h1>
        <p className="text-gray-600">
          Based on your database schema with full solicitor tracking
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Solicitors
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeSolicitors}</div>
            <p className="text-xs text-muted-foreground">
              of {stats.totalSolicitors} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Raised</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${stats.totalRaised.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.assignedCount} assigned payments
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Bonus Calculations
            </CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${stats.totalBonuses.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              ${stats.unpaidBonuses.toLocaleString()} unpaid
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unassigned</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stats.unassignedCount}
            </div>
            <p className="text-xs text-muted-foreground">
              payments need assignment
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search solicitors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* <Button className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add Solicitor
            </Button> */}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="solicitors">Solicitors</TabsTrigger>
          <TabsTrigger value="assigned">Assigned Payments</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
          {/* <TabsTrigger value="bonus-rules">Bonus Rules</TabsTrigger>
          <TabsTrigger value="calculations">Calculations</TabsTrigger> */}
        </TabsList>

        <TabsContent value="solicitors">
          <Card>
            <CardHeader>
              <CardTitle>Solicitor Directory ({solicitors.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {solicitorsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Solicitor</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Commission Rate</TableHead>
                        <TableHead>Total Raised</TableHead>
                        <TableHead>Bonus Earned</TableHead>
                        <TableHead>Hire Date</TableHead>
                        {/* <TableHead>Actions</TableHead> */}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {solicitors.map((solicitor: any) => (
                        <TableRow key={solicitor.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {solicitor.firstName} {solicitor.lastName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {solicitor.email}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Contact ID: {solicitor.contactId}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono">
                            {solicitor.solicitorCode}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusBadge(solicitor.status)}>
                              {solicitor.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{solicitor.commissionRate}%</TableCell>
                          <TableCell className="font-medium">
                            $
                            {Number(
                              solicitor.totalRaised || 0
                            ).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-green-600 font-medium">
                            $
                            {Number(
                              solicitor.bonusEarned || 0
                            ).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {solicitor.hireDate
                              ? new Date(
                                  solicitor.hireDate
                                ).toLocaleDateString()
                              : "N/A"}
                          </TableCell>
                          {/* <TableCell>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm">
                                View
                              </Button>
                              <Button variant="outline" size="sm">
                                Edit
                              </Button>
                            </div>
                          </TableCell> */}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bonus-rules">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Bonus Rules ({bonusRules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bonusRulesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rule Name</TableHead>
                        <TableHead>Solicitor</TableHead>
                        <TableHead>Bonus %</TableHead>
                        <TableHead>Payment Type</TableHead>
                        <TableHead>Min Amount</TableHead>
                        <TableHead>Max Amount</TableHead>
                        <TableHead>Effective Period</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bonusRules.map((rule: any) => (
                        <TableRow key={rule.id}>
                          <TableCell className="font-medium">
                            {rule.ruleName}
                          </TableCell>
                          <TableCell>
                            {rule.solicitorFirstName} {rule.solicitorLastName}
                          </TableCell>
                          <TableCell>{rule.bonusPercentage}%</TableCell>
                          <TableCell>
                            <Badge variant="outline">{rule.paymentType}</Badge>
                          </TableCell>
                          <TableCell>
                            ${Number(rule.minAmount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {rule.maxAmount
                              ? `$${Number(rule.maxAmount).toLocaleString()}`
                              : "No limit"}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>
                                From:{" "}
                                {new Date(
                                  rule.effectiveFrom
                                ).toLocaleDateString()}
                              </div>
                              <div>
                                To:{" "}
                                {rule.effectiveTo
                                  ? new Date(
                                      rule.effectiveTo
                                    ).toLocaleDateString()
                                  : "Ongoing"}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{rule.priority}</TableCell>
                          <TableCell>
                            <Badge
                              className={
                                rule.isActive
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-800"
                              }
                            >
                              {rule.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calculations">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Bonus Calculations ({bonusCalculations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bonusCalculationsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment ID</TableHead>
                        <TableHead>Solicitor</TableHead>
                        <TableHead>Payment Amount</TableHead>
                        <TableHead>Bonus %</TableHead>
                        <TableHead>Bonus Amount</TableHead>
                        <TableHead>Calculated</TableHead>
                        <TableHead>Payment Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bonusCalculations.map((calc: any) => (
                        <TableRow key={calc.id}>
                          <TableCell className="font-mono">
                            #{calc.paymentId}
                          </TableCell>
                          <TableCell>
                            {calc.solicitorFirstName} {calc.solicitorLastName}
                          </TableCell>
                          <TableCell>
                            ${Number(calc.paymentAmount).toLocaleString()}
                          </TableCell>
                          <TableCell>{calc.bonusPercentage}%</TableCell>
                          <TableCell className="font-medium text-green-600">
                            ${Number(calc.bonusAmount).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {new Date(calc.calculatedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                calc.isPaid
                                  ? "bg-green-100 text-green-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }
                            >
                              {calc.isPaid ? "Paid" : "Pending"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {!calc.isPaid && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleMarkBonusPaid(calc.id)}
                                  disabled={markBonusPaidMutation.isPending}
                                >
                                  {markBonusPaidMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    "Mark Paid"
                                  )}
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleRecalculateBonus(calc.paymentId)
                                }
                                disabled={recalculateBonusMutation.isPending}
                              >
                                {recalculateBonusMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Recalculate"
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assigned">
          <Card>
            <CardHeader>
              <CardTitle>
                Payments with Solicitor Assignment ({assignedPayments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {assignedPaymentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Solicitor</TableHead>
                        <TableHead>Bonus %</TableHead>
                        <TableHead>Bonus Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignedPayments.map((payment: any) => (
                        <TableRow key={payment.id}>
                          <TableCell className="font-medium">
                            #{payment.id}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {payment.contactFirstName}{" "}
                                {payment.contactLastName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {payment.contactEmail}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                $
                                {Number(
                                  payment.amountUsd || 0
                                ).toLocaleString()}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {payment.currency}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {payment.solicitorFirstName}{" "}
                                {payment.solicitorLastName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {payment.solicitorCode}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{payment.bonusPercentage}%</TableCell>
                          <TableCell className="text-green-600 font-medium">
                            ${Number(payment.bonusAmount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {new Date(payment.paymentDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={getStatusBadge(payment.paymentStatus)}
                            >
                              {payment.paymentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnassignPayment(payment.id)}
                              disabled={unassignPaymentMutation.isPending}
                            >
                              {unassignPaymentMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Unassign"
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unassigned">
          <Card>
            <CardHeader>
              <CardTitle>
                Unassigned Payments ({unassignedPayments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unassignedPaymentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : unassignedPayments.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unassignedPayments.map((payment: any) => (
                        <TableRow key={payment.id}>
                          <TableCell className="font-medium">
                            #{payment.id}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                {payment.contactFirstName}{" "}
                                {payment.contactLastName}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {payment.contactEmail}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">
                                $
                                {Number(
                                  payment.amountUsd || 0
                                ).toLocaleString()}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {payment.currency}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {new Date(payment.paymentDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {payment.categoryName}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={getStatusBadge(payment.paymentStatus)}
                            >
                              {payment.paymentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              onValueChange={(solicitorId) =>
                                handleAssignPayment(
                                  payment.id,
                                  parseInt(solicitorId)
                                )
                              }
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Assign Solicitor" />
                              </SelectTrigger>
                              <SelectContent>
                                {solicitors
                                  .filter((s: any) => s.status === "active")
                                  .map((solicitor: any) => (
                                    <SelectItem
                                      key={solicitor.id}
                                      value={solicitor.id.toString()}
                                    >
                                      {solicitor.firstName} {solicitor.lastName}{" "}
                                      ({solicitor.solicitorCode})
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium">
                    All payments have solicitor assignments!
                  </h3>
                  <p className="text-muted-foreground">
                    Great job managing your solicitor assignments.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
