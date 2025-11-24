import React, { useEffect, useState } from "react";

interface ContactDonation {
  id: number;
  firstName: string;
  lastName: string;
  address: string | null;
  totalDonations: number;
  mostRecentDonationDate: string | null;
  mostRecentDonationAmount: number | null;
}

interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const ContactsDonationsReport: React.FC = () => {
  const [contacts, setContacts] = useState<ContactDonation[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [sortBy, setSortBy] = useState<string>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState<string>("");

  const fetchContacts = async () => {
    const params = new URLSearchParams();
    params.append("page", pagination.page.toString());
    params.append("limit", pagination.limit.toString());
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    if (search.trim() !== "") {
      params.append("search", search.trim());
    }
    try {
      const res = await fetch(`/api/reports/contacts-donations?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`API Error: ${res.status}`);
      }
      const data = await res.json();
      setContacts(data.contacts);
      setPagination(data.pagination);
    } catch (error) {
      console.error("Failed to fetch contacts donations report:", error);
    }
  };

  useEffect(() => {
    fetchContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, sortBy, sortOrder, search]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination((prev) => ({ ...prev, page: newPage }));
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Contacts Donations Report</h2>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border px-3 py-2 rounded w-full max-w-sm"
        />
      </div>

      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr>
            <th
              className="border border-gray-300 px-4 py-2 cursor-pointer"
              onClick={() => handleSort("firstName")}
            >
              First Name {sortBy === "firstName" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th
              className="border border-gray-300 px-4 py-2 cursor-pointer"
              onClick={() => handleSort("lastName")}
            >
              Last Name {sortBy === "lastName" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th className="border border-gray-300 px-4 py-2">Address</th>
            <th
              className="border border-gray-300 px-4 py-2 cursor-pointer"
              onClick={() => handleSort("totalDonations")}
            >
              Total Donations {sortBy === "totalDonations" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th
              className="border border-gray-300 px-4 py-2 cursor-pointer"
              onClick={() => handleSort("mostRecentDonationDate")}
            >
              Most Recent Donation Date {sortBy === "mostRecentDonationDate" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
            </th>
            <th className="border border-gray-300 px-4 py-2">Most Recent Donation Amount</th>
          </tr>
        </thead>
        <tbody>
          {contacts.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center py-4">
                No contacts found.
              </td>
            </tr>
          ) : (
            contacts.map((contact) => (
              <tr key={contact.id}>
                <td className="border border-gray-300 px-4 py-2">{contact.firstName || "-"}</td>
                <td className="border border-gray-300 px-4 py-2">{contact.lastName || "-"}</td>
                <td className="border border-gray-300 px-4 py-2">{contact.address || "-"}</td>
                <td className="border border-gray-300 px-4 py-2">
                  {contact.totalDonations.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="border border-gray-300 px-4 py-2">
                  {contact.mostRecentDonationDate
                    ? new Date(contact.mostRecentDonationDate).toLocaleDateString()
                    : "-"}
                </td>
                <td className="border border-gray-300 px-4 py-2">
                  {contact.mostRecentDonationAmount !== null
                    ? contact.mostRecentDonationAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "-"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => handlePageChange(pagination.page - 1)}
          disabled={!pagination.hasPreviousPage}
          className={`px-4 py-2 rounded bg-blue-500 text-white ${!pagination.hasPreviousPage ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Previous
        </button>
        <span>
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <button
          onClick={() => handlePageChange(pagination.page + 1)}
          disabled={!pagination.hasNextPage}
          className={`px-4 py-2 rounded bg-blue-500 text-white ${!pagination.hasNextPage ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default ContactsDonationsReport;
