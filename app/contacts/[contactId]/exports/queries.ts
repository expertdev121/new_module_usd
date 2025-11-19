import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useSession } from "next-auth/react";

const api = axios.create({
  baseURL: "/api",
});

export const getContacts = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/contacts${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getPayments = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/payments${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getPaymentsWithDetails = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/payments/details${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getPledges = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/pledges${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getPledgesWithDetails = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/pledges/details${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getStudentRoles = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/student-roles${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getSolicitors = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/solicitors${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getCategories = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/categories${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const getContactsWithData = async (locationId?: string) => {
  const { data } = await api.get(`/zapier/contacts-with-data${locationId ? `?locationId=${locationId}` : ''}`);
  return data;
};

export const useContacts = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["contacts", session?.user?.locationId],
    queryFn: () => getContacts(session?.user?.locationId),
  });
};

export const usePayments = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["payments", session?.user?.locationId],
    queryFn: () => getPayments(session?.user?.locationId),
  });
};

export const usePaymentsWithDetails = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["payments", "detailed", session?.user?.locationId],
    queryFn: () => getPaymentsWithDetails(session?.user?.locationId),
  });
};

export const usePledges = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["pledges", session?.user?.locationId],
    queryFn: () => getPledges(session?.user?.locationId),
  });
};

export const usePledgesWithDetails = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["pledges", "detailed", session?.user?.locationId],
    queryFn: () => getPledgesWithDetails(session?.user?.locationId),
  });
};

export const useStudentRoles = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["studentRoles", session?.user?.locationId],
    queryFn: () => getStudentRoles(session?.user?.locationId),
  });
};

export const useSolicitors = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["solicitors", session?.user?.locationId],
    queryFn: () => getSolicitors(session?.user?.locationId),
  });
};

export const useCategories = () => {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["categories", session?.user?.locationId],
    queryFn: () => getCategories(session?.user?.locationId),
  });
};
