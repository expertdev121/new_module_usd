import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useSession } from "next-auth/react";

const api = axios.create({
  baseURL: "/api",
});

export const getContacts = async () => {
  const { data } = await api.get("/zapier/contacts?locationId=1");
  return data;
};

export const getPayments = async () => {
  const { data } = await api.get("/zapier/payments?locationId=1");
  return data;
};

export const getPaymentsWithDetails = async () => {
  const { data } = await api.get("/zapier/payments/details?locationId=1");
  return data;
};

export const getPledges = async () => {
  const { data } = await api.get("/zapier/pledges?locationId=1");
  return data;
};

export const getPledgesWithDetails = async () => {
  const { data } = await api.get("/zapier/pledges/details?locationId=1");
  return data;
};

export const getStudentRoles = async () => {
  const { data } = await api.get("/zapier/student-roles?locationId=1");
  return data;
};

export const getSolicitors = async () => {
  const { data } = await api.get("/zapier/solicitors?locationId=1");
  return data;
};

export const getCategories = async () => {
  const { data } = await api.get("/zapier/categories?locationId=1");
  return data;
};

export const useContacts = () => {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: getContacts,
  });
};

export const usePayments = () => {
  return useQuery({
    queryKey: ["payments"],
    queryFn: getPayments,
  });
};

export const usePaymentsWithDetails = () => {
  return useQuery({
    queryKey: ["payments", "detailed"],
    queryFn: getPaymentsWithDetails,
  });
};

export const usePledges = () => {
  return useQuery({
    queryKey: ["pledges"],
    queryFn: getPledges,
  });
};

export const usePledgesWithDetails = () => {
  return useQuery({
    queryKey: ["pledges", "detailed"],
    queryFn: getPledgesWithDetails,
  });
};

export const useStudentRoles = () => {
  return useQuery({
    queryKey: ["studentRoles"],
    queryFn: getStudentRoles,
  });
};

export const useSolicitors = () => {
  return useQuery({
    queryKey: ["solicitors"],
    queryFn: getSolicitors,
  });
};

export const useCategories = () => {
  return useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });
};
