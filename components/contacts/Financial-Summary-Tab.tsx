import { DollarSign, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";

interface FinancialSummary {
  totalPledgedUsd: number;
  totalPaidUsd: number;
  currentBalanceUsd: number;
}

interface FinancialSummaryTabProps {
  financialSummary: FinancialSummary;
}

const FinancialSummaryTab: React.FC<FinancialSummaryTabProps> = ({
  financialSummary,
}) => {
  const paymentPercentage =
    financialSummary.totalPledgedUsd > 0
      ? Math.round(
          (financialSummary.totalPaidUsd / financialSummary.totalPledgedUsd) *
            100
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Financial Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">Pledges</p>
            <p className="text-3xl font-bold">
              ${financialSummary.totalPledgedUsd}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">Total Paid</p>
            <p className="text-3xl font-bold text-green-600">
              ${financialSummary.totalPaidUsd}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">
              Current Balance
            </p>
            <p className="text-3xl font-bold text-orange-600">
              ${financialSummary.currentBalanceUsd}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Payment Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payment Progress Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Progress</span>
              <span className="font-medium">{paymentPercentage}% Complete</span>
            </div>

            <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
              <div
                className="h-4 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${paymentPercentage}%` }}
              />
            </div>

            <div className="flex justify-between items-center mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Paid: ${financialSummary.totalPaidUsd}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500" />
                <span>Remaining: ${financialSummary.currentBalanceUsd}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span>Total: ${financialSummary.totalPledgedUsd}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Status */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
              <span className="font-medium">Payment Completion Rate</span>
              <Badge
                variant={paymentPercentage === 100 ? "default" : "secondary"}
              >
                {paymentPercentage === 100 ? "Fully Paid" : "Partial Payment"}
              </Badge>
            </div>

            {paymentPercentage < 100 && (
              <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
                    Outstanding Balance: ${financialSummary.currentBalanceUsd}
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FinancialSummaryTab;
