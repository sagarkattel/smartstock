"use client";

import { DataStatus } from "@/components/settings/DataStatus";
import { ModelVersions } from "@/components/settings/ModelVersions";
import { RetrainJobs } from "@/components/settings/RetrainJobs";
import { UploadData } from "@/components/settings/UploadData";

/** Settings > General: the data SmartStock learns from, retraining, and which model is in use. */
export function GeneralSettings() {
  return (
    <>
      <DataStatus />
      <UploadData />
      <RetrainJobs />
      <ModelVersions />
    </>
  );
}
