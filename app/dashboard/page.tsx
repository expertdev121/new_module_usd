"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, Users, DollarSign, Calendar, FileText, ArrowUpRight, Filter } from "lucide-react";
import { DateRangePicker, RangeKeyDict } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import type { TooltipItem } from 'chart.js';
import { Line, Bar, Pie, Doughnut } from 'react-chartjs-2';
import {
  useDashboardOverview,
  useDashboardTrends,
  useDashboardPaymentMethods,
  useDashboardPledgeStatus,
  useDashboardTopDonors,
  useDashboardRecentActivity,
  useDashboardContactAnalytics,
  useDashboardCampaigns,
} from "@/lib/query/useDashboard";


ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_COLORS = {
  blue: 'rgb(59, 130, 246)',
  green: 'rgb(16, 185, 129)',
  orange: 'rgb(245, 158, 11)',
  red: 'rgb(239, 68, 68)',
  purple: 'rgb(139, 92, 246)',
  pink: 'rgb(236, 72, 153)',
  teal: 'rgb(20, 184, 166)',
  indigo: 'rgb(99, 102, 241)',
  yellow: 'rgb(234, 179, 8)',
  cyan: 'rgb(6, 182, 212)',
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appliedDateRange, setAppliedDateRange] = useState([
    {
      startDate: new Date(new Date().setMonth(new Date().getMonth() - 6)),
      endDate: new Date(),
      key: 'selection'
    }
  ]);

  const [tempDateRange, setTempDateRange] = useState(appliedDateRange);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isDateRangeSelected, setIsDateRangeSelected] = useState(false);

  const [loading, setLoading] = useState(false);

  // Get tab from URL params
  const activeTab = searchParams.get("tab") || "overview";

  // Data queries
  const { data: overviewData, isLoading: overviewLoading } = useDashboardOverview(
    isDateRangeSelected ? "custom" : undefined,
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: trendsData, isLoading: trendsLoading } = useDashboardTrends(
    isDateRangeSelected ? "custom" : undefined,
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: paymentMethodData, isLoading: paymentMethodsLoading } = useDashboardPaymentMethods(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: pledgeStatusData, isLoading: pledgeStatusLoading } = useDashboardPledgeStatus(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: topDonors = [], isLoading: topDonorsLoading } = useDashboardTopDonors(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: recentActivity = [], isLoading: recentActivityLoading } = useDashboardRecentActivity(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );
  const { data: contactAnalyticsData, isLoading: contactAnalyticsLoading } = useDashboardContactAnalytics(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined
  );

  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const { data: campaignsData, isLoading: campaignsLoading } = useDashboardCampaigns(
    isDateRangeSelected ? appliedDateRange[0].startDate.toISOString().split('T')[0] : undefined,
    isDateRangeSelected ? appliedDateRange[0].endDate.toISOString().split('T')[0] : undefined,
    selectedLocationId || undefined
  );

  // Pagination states
  const [contributorsPage, setContributorsPage] = useState(1);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const itemsPerPage = 10;

  const isLoading = overviewLoading || trendsLoading || paymentMethodsLoading || pledgeStatusLoading || topDonorsLoading || recentActivityLoading || contactAnalyticsLoading || campaignsLoading;

  if (status === "loading") return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!session) {
    router.push("/auth/login");
    return null;
  }
  if (session.user.role !== "admin" && session.user.role !== "super_admin") {
    router.push("/contacts");
    return null;
  }

  const exportData = async (format: "csv" | "pdf") => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("format", format);
      if (isDateRangeSelected && appliedDateRange[0].startDate && appliedDateRange[0].endDate) {
        params.append("startDate", appliedDateRange[0].startDate.toISOString().split('T')[0]);
        params.append("endDate", appliedDateRange[0].endDate.toISOString().split('T')[0]);
      }

      const response = await fetch(`/api/dashboard/export?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-export-${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Chart configurations
  const trendChartData = trendsData ? {
    labels: trendsData.labels,
    datasets: [
      {
        label: 'Pledges',
        data: trendsData.pledges,
        borderColor: CHART_COLORS.blue,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Payments',
        data: trendsData.payments,
        borderColor: CHART_COLORS.green,
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  } : { labels: [], datasets: [] };

  const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      tooltip: {
        callbacks: {
          label: function (context: TooltipItem<'line'>) {
            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (tickValue: string | number) {
            if (typeof tickValue === 'number') {
              if (tickValue >= 1000) {
                return '$' + (tickValue / 1000) + 'k';
              } else {
                return formatCurrency(tickValue);
              }
            }
            return tickValue;
          }
        }
      }
    }
  };

  const paymentMethodChartData = paymentMethodData ? {
    labels: paymentMethodData.labels,
    datasets: [
      {
        data: paymentMethodData.values,
        backgroundColor: [
          CHART_COLORS.blue,
          CHART_COLORS.green,
          CHART_COLORS.orange,
          CHART_COLORS.red,
          CHART_COLORS.purple,
          CHART_COLORS.pink,
          CHART_COLORS.teal,
          CHART_COLORS.indigo,
          CHART_COLORS.yellow,
          CHART_COLORS.cyan,
        ],
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  } : { labels: [], datasets: [] };

  const paymentMethodChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
      },
      tooltip: {
        callbacks: {
          label: function (context: TooltipItem<'doughnut'>) {
            const label = context.label || '';
            const value = formatCurrency(context.parsed);
            const count = paymentMethodData?.counts[context.dataIndex] || 0;
            return label + ': ' + value + ' (' + count + ' transactions)';
          }
        }
      }
    },
  };

  const pledgeStatusChartData = pledgeStatusData ? {
    labels: pledgeStatusData.labels,
    datasets: [
      {
        label: 'Number of Pledges',
        data: pledgeStatusData.values,
        backgroundColor: [CHART_COLORS.green, CHART_COLORS.orange, CHART_COLORS.red],
        borderWidth: 1,
        borderColor: '#fff',
      },
    ],
  } : { labels: [], datasets: [] };

  const pledgeStatusChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      }
    }
  };

  const paymentVolumeChartData = paymentMethodData ? {
    labels: paymentMethodData.labels,
    datasets: [
      {
        label: 'Payment Volume',
        data: paymentMethodData.values,
        backgroundColor: CHART_COLORS.green,
        borderColor: CHART_COLORS.green,
        borderWidth: 1,
      },
    ],
  } : { labels: [], datasets: [] };

  const paymentVolumeChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: TooltipItem<'bar'>) {
            return formatCurrency(context.parsed.y);
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function (tickValue: string | number) {
            if (typeof tickValue === 'number') {
              return '$' + (tickValue / 1000) + 'k';
            }
            return tickValue;
          }
        }
      }
    }
  };

  const isAdmin = session.user.role === "admin";
  const isSuperAdmin = session.user.role === "super_admin";

  return (
    <div className="bg-gray-50">
      {isAdmin || isSuperAdmin ? (
        <>
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-500 mt-1">Welcome back, {session.user.email}</p>
              </div>
              <div className="flex gap-3 items-center">
                <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (isDateRangeSelected) {
                          setTempDateRange([...appliedDateRange]);
                        } else {
                          setTempDateRange([
                            {
                              startDate: new Date(new Date().setMonth(new Date().getMonth() - 6)),
                              endDate: new Date(),
                              key: 'selection'
                            }
                          ]);
                        }
                      }}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      {isDateRangeSelected ? `${appliedDateRange[0].startDate.toLocaleDateString()} - ${appliedDateRange[0].endDate.toLocaleDateString()}` : "All Time"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <DateRangePicker
                      onChange={(item: RangeKeyDict) => setTempDateRange([item.selection as { startDate: Date; endDate: Date; key: string }])}
                      showSelectionPreview={true}
                      moveRangeOnFirstSelection={false}
                      months={2}
                      ranges={tempDateRange}
                      direction="horizontal"
                    />
                    <div className="flex justify-end gap-2 p-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (isDateRangeSelected) {
                            setTempDateRange([...appliedDateRange]);
                          } else {
                            setTempDateRange([
                              {
                                startDate: new Date(new Date().setMonth(new Date().getMonth() - 6)),
                                endDate: new Date(),
                                key: 'selection'
                              }
                            ]);
                          }
                          setIsDatePickerOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsDateRangeSelected(false);
                          setIsDatePickerOpen(false);
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setAppliedDateRange([...tempDateRange]);
                          setIsDateRangeSelected(true);
                          setIsDatePickerOpen(false);
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button variant="outline" onClick={() => exportData("csv")} disabled={loading}>
                  <Download className="w-4 h-4 mr-2" />
                  CSV
                </Button>
                <Button variant="outline" onClick={() => exportData("pdf")} disabled={loading}>
                  <Download className="w-4 h-4 mr-2" />
                  PDF
                </Button>
              </div>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const params = new URLSearchParams(searchParams);
                params.set("tab", value);
                router.replace(`/dashboard?${params.toString()}`);
              }}
              className="space-y-6"
            >
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="pledges">Pledges</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
                <TabsTrigger value="contacts">Contacts</TabsTrigger>
                <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Contacts</CardTitle>
                      <Users className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overviewData?.totalContacts.toLocaleString() || 0}</div>
                      <p className="text-xs text-green-600 flex items-center mt-1">
                        <ArrowUpRight className="w-3 h-3 mr-1" />
                        {overviewData?.contactsGrowthPercentage || 0}% from previous period
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Pledges</CardTitle>
                      <FileText className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(overviewData?.totalPledgeAmount || 0)}</div>
                      <p className="text-xs text-gray-600 mt-1">{overviewData?.totalPledges || 0} Pledges</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Actual Payments</CardTitle>
                      <DollarSign className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(overviewData?.totalPaymentAmount || 0)}</div>
                      <p className="text-xs text-green-600 flex items-center mt-1">
                        <ArrowUpRight className="w-3 h-3 mr-1" />
                        {overviewData?.collectionRate || 0}% collection rate
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Active Plans</CardTitle>
                      <Calendar className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{overviewData?.activePlans || 0}</div>
                      <p className="text-xs text-gray-600 mt-1">
                        {overviewData?.scheduledPayments || 0} scheduled payments
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Pledges vs Payments Trend</CardTitle>
                      <CardDescription>
                        Comparison over selected period
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <Line data={trendChartData} options={trendChartOptions} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Payment Methods Distribution</CardTitle>
                      <CardDescription>Breakdown by payment type</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <Doughnut data={paymentMethodChartData} options={paymentMethodChartOptions} />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Bottom Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Top Donors</CardTitle>
                      <CardDescription>Highest contributing contacts</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {topDonors.map((donor, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold">
                                {index + 1}
                              </div>
                              <div>
                                <p className="font-medium">{donor.name}</p>
                                <p className="text-sm text-gray-500">{donor.pledges} Pledges</p>
                                <div className="text-xs text-gray-400">
                                  <span className="text-blue-600">Pledges: {formatCurrency(donor.pledgeAmount)}</span>
                                  {donor.thirdPartyAmount > 0 && (
                                    <span className="ml-2 text-purple-600">Third-party: {formatCurrency(donor.thirdPartyAmount)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{formatCurrency(donor.amount)}</p>
                              {/* <p className="text-sm text-green-600">{Math.round(donor.completion * 100) / 100}% complete</p> */}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Recent Activity</CardTitle>
                      <CardDescription>Latest transactions</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {recentActivity.map((activity, index) => (
                          <div key={index} className="flex items-center justify-between border-b pb-3 last:border-0">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${activity.type === 'payment' ? 'bg-green-500' :
                                activity.type === 'Pledges' ? 'bg-blue-500' : 'bg-purple-500'
                                }`} />
                              <div>
                                <p className="font-medium text-sm">{activity.contactName}</p>
                                <p className="text-xs text-gray-500">{activity.method} • {activity.date}</p>
                              </div>
                            </div>
                            <p className="font-semibold">{formatCurrency(activity.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="pledges" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Pledges Status Overview</CardTitle>
                      <CardDescription>Current status of all Pledges</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <Bar data={pledgeStatusChartData} options={pledgeStatusChartOptions} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Pledges Statistics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Average Pledges</span>
                        <span className="font-bold">{formatCurrency(overviewData?.avgPledgeSize || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Active Plans</span>
                        <span className="font-bold">{overviewData?.activePlans || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Scheduled</span>
                        <span className="font-bold">{overviewData?.scheduledPayments || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Unscheduled</span>
                        <span className="font-bold">{overviewData?.unscheduledPayments || 0}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Payment Volume by Method</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <Bar data={paymentVolumeChartData} options={paymentVolumeChartOptions} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Payment Statistics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total Payments</span>
                        <span className="font-bold">{overviewData?.totalPayments || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Average Payment</span>
                        <span className="font-bold">{formatCurrency(overviewData?.avgPaymentSize || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Third Party</span>
                        <span className="font-bold">{overviewData?.thirdPartyPayments || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Collection Rate</span>
                        <span className="font-bold text-green-600">{overviewData?.collectionRate || 0}%</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="contacts" className="space-y-6">
                {/* Contact Creation Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle>Contact Creation Trend</CardTitle>
                    <CardDescription>Monthly contact additions over the last 12 months</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <Line
                        data={{
                          labels: contactAnalyticsData?.contactCreationData.labels || [],
                          datasets: [
                            {
                              label: 'New Contacts',
                              data: contactAnalyticsData?.contactCreationData.values || [],
                              borderColor: CHART_COLORS.indigo,
                              backgroundColor: 'rgba(99, 102, 241, 0.1)',
                              fill: true,
                              tension: 0.4,
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              display: false,
                            },
                          },
                          scales: {
                            y: {
                              beginAtZero: true,
                            },
                          },
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Engagement and Relationship Data */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Contact Engagement</CardTitle>
                      <CardDescription>Contacts with Pledges and payments</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Total Contacts</span>
                        <span className="font-bold">{contactAnalyticsData?.engagementData.totalContacts || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">With Pledges</span>
                        <span className="font-bold text-blue-600">{contactAnalyticsData?.engagementData.contactsWithPledges || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">With Payments</span>
                        <span className="font-bold text-green-600">{contactAnalyticsData?.engagementData.contactsWithPayments || 0}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Relationship Types</CardTitle>
                      <CardDescription>Distribution of contact relationships</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[200px]">
                        <Bar
                          data={{
                            labels: contactAnalyticsData?.relationshipData.labels || [],
                            datasets: [
                              {
                                label: 'Count',
                                data: contactAnalyticsData?.relationshipData.values || [],
                                backgroundColor: CHART_COLORS.purple,
                                borderColor: CHART_COLORS.purple,
                                borderWidth: 1,
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                display: false,
                              },
                            },
                            scales: {
                              y: {
                                beginAtZero: true,
                              },
                            },
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Top Contributors */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Contributors</CardTitle>
                    <CardDescription>Contacts with highest Pledges and payment amounts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {contactAnalyticsData?.topContributors.map((contributor, index) => (
                        <div key={index} className="flex items-center justify-between border-b pb-3 last:border-0">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-semibold">
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium">{contributor.name}</p>
                              <p className="text-sm text-gray-500">
                                {contributor.pledges} Pledges • {contributor.payments} payments
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(contributor.pledgeAmount)}</p>
                            <p className="text-sm text-green-600">{formatCurrency(contributor.paymentAmount)} paid</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="campaigns" className="space-y-6">
                {/* Campaign Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Campaigns</CardTitle>
                      <FileText className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{campaignsData?.totalCampaigns || 0}</div>
                      <p className="text-xs text-gray-600 mt-1">Active campaigns</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Total Raised</CardTitle>
                      <DollarSign className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(campaignsData?.totalRaised || 0)}</div>
                      <p className="text-xs text-green-600 mt-1">From campaigns</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Average Donation</CardTitle>
                      <Users className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(campaignsData?.averageDonation || 0)}</div>
                      <p className="text-xs text-gray-600 mt-1">Per campaign</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">Top Campaign</CardTitle>
                      <ArrowUpRight className="w-4 h-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{campaignsData?.topCampaign?.name || 'N/A'}</div>
                      <p className="text-xs text-green-600 mt-1">{formatCurrency(campaignsData?.topCampaign?.amount || 0)} raised</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Campaign Performance Charts - Enhanced */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Horizontal Bar Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Campaign Performance Ranking</CardTitle>
                      <CardDescription>Top campaigns by donation amount</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[400px]">
                        <Bar
                          data={{
                            labels: campaignsData?.campaigns?.slice(0, 8).map(c => c.name) || [],
                            datasets: [
                              {
                                label: 'Amount Raised',
                                data: campaignsData?.campaigns?.slice(0, 8).map(c => Number(c.amount) || 0) || [],
                                backgroundColor: (context) => {
                                  // Guard against undefined context.parsed during legend generation
                                  if (!context.parsed || context.parsed.x === undefined) {
                                    return 'rgba(99, 102, 241, 0.8)'; // Return default color
                                  }

                                  const value = Number(context.parsed.x) || 0;
                                  const amounts = campaignsData?.campaigns?.map(c => Number(c.amount) || 0) || [0];
                                  const max = Math.max(...amounts);
                                  const ratio = max > 0 ? value / max : 0;

                                  if (ratio > 0.7) return 'rgba(16, 185, 129, 0.8)';
                                  if (ratio > 0.4) return 'rgba(59, 130, 246, 0.8)';
                                  return 'rgba(99, 102, 241, 0.8)';
                                },

                                borderRadius: 8,
                                borderSkipped: false,
                              },
                            ],
                          }}
                          options={{
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                display: false,
                              },
                              tooltip: {
                                callbacks: {
                                  label: function (context: TooltipItem<'bar'>) {
                                    if (!context.parsed || typeof context.parsed !== 'object') {
                                      return '';
                                    }
                                    const value = 'x' in context.parsed ? context.parsed.x : 0;
                                    if (value === undefined || value === null) {
                                      return '';
                                    }
                                    return 'Raised: ' + formatCurrency(Number(value) || 0);
                                  }
                                }
                              }
                            },
                            scales: {
                              x: {
                                beginAtZero: true,
                                grid: {
                                  display: true,
                                  color: 'rgba(0, 0, 0, 0.05)',
                                },
                                ticks: {
                                  callback: function (tickValue: string | number) {
                                    if (typeof tickValue === 'number') {
                                      return '$' + (tickValue / 1000) + 'k';
                                    }
                                    return tickValue;
                                  }
                                }
                              },
                              y: {
                                grid: {
                                  display: false,
                                },
                              }
                            }
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Donut Chart with Campaign Distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Campaign Distribution</CardTitle>
                      <CardDescription>Percentage share of total donations</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[400px]">
                        <Doughnut
                          data={{
                            labels: campaignsData?.campaigns?.slice(0, 6).map(c => c.name) || [],
                            datasets: [
                              {
                                data: campaignsData?.campaigns?.slice(0, 6).map(c => Number(c.amount) || 0) || [],
                                backgroundColor: [
                                  'rgba(59, 130, 246, 0.9)',
                                  'rgba(16, 185, 129, 0.9)',
                                  'rgba(139, 92, 246, 0.9)',
                                  'rgba(245, 158, 11, 0.9)',
                                  'rgba(236, 72, 153, 0.9)',
                                  'rgba(20, 184, 166, 0.9)',
                                ],
                                borderWidth: 3,
                                borderColor: '#fff',
                                hoverOffset: 10,
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                position: 'bottom',
                                labels: {
                                  padding: 15,
                                  usePointStyle: true,
                                  pointStyle: 'circle',
                                  font: {
                                    size: 11,
                                  }
                                }
                              },
                              tooltip: {
                                callbacks: {
                                  label: function (context: TooltipItem<'doughnut'>) {
                                    const label = context.label || '';
                                    if (context.parsed === undefined || context.parsed === null) {
                                      return label;
                                    }
                                    const value = context.parsed;
                                    const total = (context.dataset.data as number[]).reduce((a, b) => (Number(a) || 0) + (Number(b) || 0), 0);
                                    const percentage = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : '0.0';
                                    return [label, formatCurrency(Number(value) || 0) + ' (' + percentage + '%)'];
                                  }
                                }
                              }
                            },
                            cutout: '70%',
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Combined Bar Chart with Donations Count */}
                <Card>
                  <CardHeader>
                    <CardTitle>Campaign Performance Overview</CardTitle>
                    <CardDescription>Amount raised vs number of donations</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px]">
                      <Bar
                        data={{
                          labels: campaignsData?.campaigns?.slice(0, 10).map(c => c.name) || [],
                          datasets: [
                            {
                              label: 'Amount Raised',
                              data: campaignsData?.campaigns?.slice(0, 10).map(c => Number(c.amount) || 0) || [],
                              backgroundColor: 'rgba(59, 130, 246, 0.8)',
                              borderRadius: 6,
                              borderSkipped: false,
                              yAxisID: 'y',
                            },
                            {
                              label: 'Number of Donations',
                              data: campaignsData?.campaigns?.slice(0, 10).map(c => Number(c.donations) || 0) || [],
                              backgroundColor: 'rgba(16, 185, 129, 0.8)',
                              borderRadius: 6,
                              borderSkipped: false,
                              yAxisID: 'y1',
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          interaction: {
                            mode: 'index',
                            intersect: false,
                          },
                          plugins: {
                            legend: {
                              position: 'top',
                              labels: {
                                usePointStyle: true,
                                padding: 15,
                              }
                            },
                            tooltip: {
                              callbacks: {
                                label: function (context: TooltipItem<'bar'>) {
                                  const label = context.dataset.label || '';
                                  if (!context.parsed || context.parsed.y === undefined || context.parsed.y === null) {
                                    return label;
                                  }
                                  if (context.datasetIndex === 0) {
                                    return label + ': ' + formatCurrency(Number(context.parsed.y) || 0);
                                  }
                                  return label + ': ' + (Number(context.parsed.y) || 0);
                                }
                              }
                            }
                          },
                          scales: {
                            y: {
                              type: 'linear',
                              display: true,
                              position: 'left',
                              beginAtZero: true,
                              grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                              },
                              ticks: {
                                callback: function (tickValue: string | number) {
                                  if (typeof tickValue === 'number') {
                                    return '$' + (tickValue / 1000) + 'k';
                                  }
                                  return tickValue;
                                }
                              }
                            },
                            y1: {
                              type: 'linear',
                              display: true,
                              position: 'right',
                              beginAtZero: true,
                              grid: {
                                drawOnChartArea: false,
                              },
                            },
                            x: {
                              grid: {
                                display: false,
                              },
                            }
                          }
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Top Campaigns List */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Performing Campaigns</CardTitle>
                    <CardDescription>Campaigns with highest donation amounts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {campaignsData?.campaigns?.slice((campaignsPage - 1) * itemsPerPage, campaignsPage * itemsPerPage).map((campaign, index) => (
                        <div key={index} className="flex items-center justify-between border-b pb-3 last:border-0">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold">
                              {(campaignsPage - 1) * itemsPerPage + index + 1}
                            </div>
                            <div>
                              <p className="font-medium">{campaign.name}</p>
                              <p className="text-sm text-gray-500">{campaign.donations} donations</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(Number(campaign.amount) || 0)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Pagination for Top Campaigns */}
                    {campaignsData?.campaigns && campaignsData.campaigns.length > itemsPerPage && (
                      <div className="flex items-center justify-between mt-6">
                        <div className="text-sm text-gray-600">
                          Showing {(campaignsPage - 1) * itemsPerPage + 1} to {Math.min(campaignsPage * itemsPerPage, campaignsData.campaigns.length)} of {campaignsData.campaigns.length} campaigns
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCampaignsPage(campaignsPage - 1)}
                            disabled={campaignsPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="text-sm text-gray-600">
                            Page {campaignsPage} of {Math.ceil((campaignsData.campaigns.length || 0) / itemsPerPage)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCampaignsPage(campaignsPage + 1)}
                            disabled={campaignsPage >= Math.ceil((campaignsData.campaigns.length || 0) / itemsPerPage)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Campaign Contributors */}
                <Card>
                  <CardHeader>
                    <CardTitle>Campaign Contributors</CardTitle>
                    <CardDescription>Contacts who have contributed to campaigns</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {campaignsData?.details?.reduce((acc: { campaignCode: string; contributors: { contactName: string; paymentAmount: number; paymentDate: string; paymentMethod: string }[] }[], detail) => {
                        const existingCampaign = acc.find(c => c.campaignCode === detail.campaignCode);
                        if (!existingCampaign) {
                          acc.push({
                            campaignCode: detail.campaignCode,
                            contributors: [{
                              contactName: detail.contactName,
                              paymentAmount: detail.paymentAmount,
                              paymentDate: detail.paymentDate,
                              paymentMethod: detail.paymentMethod
                            }]
                          });
                        } else {
                          existingCampaign.contributors.push({
                            contactName: detail.contactName,
                            paymentAmount: detail.paymentAmount,
                            paymentDate: detail.paymentDate,
                            paymentMethod: detail.paymentMethod
                          });
                        }
                        return acc;
                      }, []).slice(0, 3).map((campaignDetail, index: number) => (
                        <div key={index} className="border rounded-lg p-4">
                          <h4 className="font-semibold text-lg mb-3">{campaignDetail.campaignCode}</h4>
                          <div className="space-y-2">
                            {campaignDetail.contributors.slice(0, 5).map((contributor, contribIndex: number) => (
                              <div key={contribIndex} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                  <div className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-semibold">
                                    {contribIndex + 1}
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm">{contributor.contactName}</p>
                                    <p className="text-xs text-gray-500">{contributor.paymentMethod} • {new Date(contributor.paymentDate).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <p className="font-semibold text-green-600">{formatCurrency(Number(contributor.paymentAmount) || 0)}</p>
                              </div>
                            ))}
                            {campaignDetail.contributors.length > 5 && (
                              <p className="text-xs text-gray-500 mt-2">+{campaignDetail.contributors.length - 5} more contributors</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
        </>
      ) : null}
    </div>
  );
}
