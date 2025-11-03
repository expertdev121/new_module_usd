"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

export default function FactsDialog() {
  const [open, setOpen] = useState(false);
  const webpageUrl = "https://factsmgt.com";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* <DialogTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add From Facts
        </Button>
      </DialogTrigger> */}
      <DialogContent className="max-w-[95vw] w-full h-[90vh] rounded-md p-6 md:max-w-7xl">
        <div className="flex-1 p-6 pt-0 h-full">
          <iframe
            src={webpageUrl}
            className="w-full h-full border rounded-md"
            title="Remittance History"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
