"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

type TableListResponse = {
  dbId: string;
  tables: string[];
};

type TableDataResponse = {
  dbId: string;
  tableName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function DatabaseViewerPage() {
  const { dbId } = useParams<{ dbId: string }>();
  const backendUrl = (
    process.env.NEXT_PUBLIC_VISUALIZATION_BACKEND_URL ?? "http://localhost:8080"
  ).replace(/\/$/, "");

  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTablesLoading(true);
    setError(null);
    fetch(`${backendUrl}/db/${dbId}/tables`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch tables (${res.status})`);
        return res.json();
      })
      .then((data: TableListResponse) => {
        setTables(data.tables);
        if (data.tables.length > 0) setSelectedTable(data.tables[0]);
        setTablesLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setTablesLoading(false);
      });
  }, [dbId, backendUrl]);

  const fetchTableData = useCallback(
    async (table: string, p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${backendUrl}/db/${dbId}/tables/${table}?page=${p}&pageSize=50`,
        );
        if (!res.ok) throw new Error(`Failed to fetch data (${res.status})`);
        const data: TableDataResponse = await res.json();
        setTableData(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [dbId, backendUrl],
  );

  useEffect(() => {
    if (selectedTable) {
      fetchTableData(selectedTable, page);
    }
  }, [selectedTable, page, fetchTableData]);

  const handleTableSelect = (table: string) => {
    setSelectedTable(table);
    setPage(1);
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 truncate">
            {dbId}
          </h2>
          <p className="text-xs text-gray-500 mt-1">Database Explorer</p>
        </div>
        {tablesLoading ? (
          <div className="p-4 text-sm text-gray-500">Loading tables...</div>
        ) : (
          <nav className="p-2">
            {tables.map((table) => (
              <button
                key={table}
                onClick={() => handleTableSelect(table)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedTable === table
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {table}
              </button>
            ))}
            {tables.length === 0 && !error && (
              <p className="px-3 py-2 text-sm text-gray-400">No tables found</p>
            )}
          </nav>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {selectedTable ?? "Select a table"}
            </h1>
            {tableData && (
              <p className="text-sm text-gray-500">
                {tableData.totalRows.toLocaleString()} rows
              </p>
            )}
          </div>
          {tableData && tableData.totalPages > 1 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {tableData.totalPages}
              </span>
              <button
                onClick={() =>
                  setPage((p) => Math.min(tableData.totalPages, p + 1))
                }
                disabled={page >= tableData.totalPages}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              Loading...
            </div>
          ) : tableData && tableData.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {tableData.columns.map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tableData.rows.map((row, i) => (
                    <tr
                      key={i}
                      className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      {tableData.columns.map((col) => (
                        <td
                          key={col}
                          className="px-4 py-2 whitespace-nowrap text-gray-800 max-w-xs truncate"
                          title={formatCellValue(row[col])}
                        >
                          {formatCellValue(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : tableData && tableData.rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              Table is empty
            </div>
          ) : !error ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              Select a table to view its data
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
