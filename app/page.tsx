"use client";

// 서지 정보 관리 대시보드 — Next.js (App Router) demo
// --------------------------------------------------
// ✅ 포함 내용
// 1) KPI 카드 4종 (순서: 새로 들어온 데이터 → FRBR 기반 생성 → 새 Work 생성 → Work 총계)
// 2) 최근 7일 추이 막대 그래프
// 3) 데이터 파이프라인 헬스 체크 (신호등 + 6개월 히트맵)
// 4) 청구기호 첫째 자리(0~9) 분포 파이 차트 + [금일/최근7일] 토글
// 5) Work 클러스터링 요약(총 반입/배정/미배정) + [금일/최근7일] 토글
// 6) 운영 메모 편집(수정 버튼으로 textarea 토글)
// 7) 테이블(Cluster/신뢰도/근거 컬럼 제거) + 모달(검토 → 우측 확장 수정, Work 검색/재배정/새 Work 생성)
// ※ shadcn/ui, lucide-react, recharts 사용 가정

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CalendarIcon,
  RefreshCcw,
  TrendingUp,
  BookUp,
  Database,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  Clock,
  FileCheck,
  AlertTriangle,
  Timer,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

// ---------------------------
// 0) 타입 정의
// ---------------------------

type KPIResponse = {
  date: string; // YYYY-MM-DD
  newWorks: number; // 새로 생성된 Work(저작) 수
  newBiblio: number; // 새로 들어온 biblio(raw) 수
  frbrCreated: number; // FRBR 기반 정규화 건수
  workTotal: number; // 현재 Work 총 수
  workDeltaD1: number; // 어제 대비 증감
  series7d: Array<{
    date: string;
    newWorks: number;
    newBiblio: number;
    frbrCreated: number;
    workTotal: number;
  }>; // 7일 추이 (스파크라인용)
};

type ClusterRow = {
  bookId: string;
  title: string;
  author: string;
  workId: string;
  // (UI 요구로 clusterId/confidence/reasons는 테이블에서 제거)
};

type ClusterSummaryNew = {
  date: string;
  period: "today" | "7d";
  totalIn: number; // 총 반입된 도서 수
  assigned: number; // Work 배정 수
  unassigned: number; // 미배정 수
};

type MemoItem = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type ProgressData = {
  overallProgress: number; // 전체 진행률 (%)
  apisInProgress: number; // 작업 중인 API 수
  totalApis: number; // 전체 API 수
  efficiency: number; // 효율성 (%)
  processingSpeed: number; // 처리 속도 (건/시간)
  estimatedCompletion: string; // 예상 완료 시간
  completedFiles: number; // 완료된 파일 수
  totalFiles: number; // 전체 파일 수
  errorRate: number; // 오류율 (%)
  totalErrors: number; // 총 오류 수
  executionTime: string; // 실행 시간 (HH:MM:SS)
  startTime: string; // 시작 시간
};

type PipelineStatus = {
  dataImport: "success" | "warning" | "error";
  frbr: "success" | "warning" | "error";
  workClustering: "success" | "warning" | "error";
};

// ---------------------------
// 1) 페치 유틸 + Mock
// ---------------------------

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// 날짜별 KPI 데이터 생성 함수
function generateKPIData(date: string): KPIResponse {
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay();

  // 날짜 기반 시드로 일관된 데이터 생성
  const seed = date.split("-").join("");
  const hash = seed.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);

  const random = Math.abs(hash) % 100;

  // 평일/주말에 따른 기본값 조정
  const baseMultiplier = dayOfWeek >= 1 && dayOfWeek <= 5 ? 1.2 : 0.8;

  const newWorks = Math.floor(((random % 20) + 5) * baseMultiplier);
  const newBiblio = Math.floor(((random % 30) + 20) * baseMultiplier);
  const frbrCreated = Math.floor(((random % 25) + 10) * baseMultiplier);
  const workTotal = 189000 + Math.floor(random % 1000);
  const workDeltaD1 = Math.floor(((random % 50) + 20) * baseMultiplier);

  // 7일 시리즈 데이터 생성
  const series7d = Array.from({ length: 7 }, (_, i) => {
    const seriesDate = new Date(dateObj);
    seriesDate.setDate(seriesDate.getDate() - (6 - i));
    const seriesSeed = seriesDate
      .toISOString()
      .slice(0, 10)
      .split("-")
      .join("");
    const seriesHash = seriesSeed.split("").reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
    const seriesRandom = Math.abs(seriesHash) % 100;

    return {
      date: seriesDate.toISOString().slice(5, 10).replace("-", "-"),
      newWorks: Math.floor(((seriesRandom % 20) + 5) * baseMultiplier),
      newBiblio: Math.floor(((seriesRandom % 30) + 20) * baseMultiplier),
      frbrCreated: Math.floor(((seriesRandom % 25) + 10) * baseMultiplier),
      workTotal: 189000 + Math.floor(seriesRandom % 1000),
    };
  });

  return {
    date,
    newWorks,
    newBiblio,
    frbrCreated,
    workTotal,
    workDeltaD1,
    series7d,
  };
}

const mockKPI: KPIResponse = generateKPIData("2025-10-22");

const mockClusterRows: ClusterRow[] = Array.from({ length: 12 }).map(
  (_, i) => ({
    bookId: `B-${1000 + i}`,
    title: `예시 도서 제목 ${i + 1}`,
    author: i % 3 === 0 ? "홍길동" : i % 3 === 1 ? "김철수" : "이영희",
    workId: `W-${500 + Math.floor(i / 2)}`,
  })
);

// 진행률 데이터 Mock
const mockProgressData: ProgressData = {
  overallProgress: 13.8,
  apisInProgress: 5,
  totalApis: 40,
  efficiency: 15.0,
  processingSpeed: 2500,
  estimatedCompletion: "07/15 13:47",
  completedFiles: 20,
  totalFiles: 145,
  errorRate: 0.8,
  totalErrors: 78,
  executionTime: "01:00:49",
  startTime: "오전 3:09:18",
};

// ---------------------------
// 2) 상단 필터바
// ---------------------------

function FilterBar({ onRefresh }: { onRefresh: () => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
      <div className="flex flex-col">
        <label className="text-sm text-muted-foreground mb-1">날짜</label>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <CalendarIcon className="h-4 w-4" />
            <input
              type="date"
              className="outline-none bg-transparent"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <Button
            variant="outline"
            className="rounded-xl bg-transparent"
            onClick={onRefresh}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col">
        <label className="text-sm text-muted-foreground mb-1">
          검색 (서명/저자)
        </label>
        <div className="flex gap-2">
          <Input
            placeholder="예: 파이썬, 홍길동"
            className="rounded-xl"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button className="rounded-xl">검색</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------
// 3) KPI 카드 (순서 반영)
// ---------------------------

function KPICards({ kpi }: { kpi: KPIResponse }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* 1) 새로 들어온 데이터 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            새로 들어온 데이터
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">
            {kpi.newBiblio.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            biblio(raw) 기준
          </div>
          <MiniSpark
            series={kpi.series7d.map((d) => ({
              date: d.date,
              value: d.newBiblio,
            }))}
          />
        </CardContent>
      </Card>
      {/* 2) FRBR 기반 생성 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            FRBR 기반 생성
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">
            {kpi.frbrCreated.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            정규화(Work/Expr/Manif) 건수
          </div>
          <MiniSpark
            series={kpi.series7d.map((d) => ({
              date: d.date,
              value: d.frbrCreated,
            }))}
          />
        </CardContent>
      </Card>
      {/* 3) 새 Work(저작) 생성 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookUp className="h-4 w-4" />새 Work(저작) 생성
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">
            {kpi.newWorks.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">신규 저작 수</div>
          <MiniSpark
            series={kpi.series7d.map((d) => ({
              date: d.date,
              value: d.newWorks,
            }))}
          />
        </CardContent>
      </Card>
      {/* 4) Work 총계 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Work 총계
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">
            {kpi.workTotal.toLocaleString()}
          </div>
          <div className="text-xs text-emerald-600 mt-1">
            어제 대비 +{kpi.workDeltaD1.toLocaleString()}
          </div>
          <MiniSpark
            series={kpi.series7d.map((d) => ({
              date: d.date,
              value: d.workTotal,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MiniSpark({
  series,
}: {
  series: Array<{ date: string; value: number }>;
}) {
  return (
    <div className="h-16 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <XAxis hide dataKey="date" />
          <YAxis hide />
          <Tooltip formatter={(v) => v.toLocaleString()} />
          <Line
            type="monotone"
            dataKey="value"
            dot={false}
            strokeWidth={2}
            stroke="#3b82f6"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------
// 4) 진행률 카드 컴포넌트들
// ---------------------------

function ProgressCards({ progressData }: { progressData: ProgressData }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* 전체 진행률 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            전체 진행률
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-2">
            {progressData.overallProgress}%
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-400 to-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressData.overallProgress}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 작업 중인 API */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            작업 중인 API
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {progressData.apisInProgress} / {progressData.totalApis}
          </div>
          <div className="text-sm text-green-600 font-medium">
            ▲ {progressData.efficiency}% 효율
          </div>
        </CardContent>
      </Card>

      {/* 처리 속도 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            처리 속도
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {progressData.processingSpeed.toLocaleString()} 건/시간
          </div>
          <div className="text-sm text-gray-500">
            예상 완료: {progressData.estimatedCompletion}
          </div>
        </CardContent>
      </Card>

      {/* 완료된 파일 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            완료된 파일
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-2">
            {progressData.completedFiles} / {progressData.totalFiles}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-400 to-green-500 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  (progressData.completedFiles / progressData.totalFiles) * 100
                }%`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 오류율 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            오류율
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {progressData.errorRate}%
          </div>
          <div className="text-sm text-gray-500">
            총 오류: {progressData.totalErrors} 건
          </div>
        </CardContent>
      </Card>

      {/* 실행 시간 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4" />
            실행 시간
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {progressData.executionTime}
          </div>
          <div className="text-sm text-gray-500">
            시작: {progressData.startTime}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendBarChart({ kpi }: { kpi: KPIResponse }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">최근 7일 추이</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={kpi.series7d}>
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="newBiblio"
                fill="#3b82f6"
                name="새로 들어온 데이터"
              />
              <Bar dataKey="frbrCreated" fill="#10b981" name="FRBR 기반 생성" />
              <Bar dataKey="newWorks" fill="#f59e0b" name="새 Work 생성" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function HeatmapSection({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
}) {
  const weeks = 53;
  const days = 7;
  function dateFromOffset(offset: number) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  }
  // 고정된 더미 데이터 생성 (클릭해도 색상이 바뀌지 않도록)
  const cells: Array<{ date: string; value: number }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    for (let d = 0; d < days; d++) {
      const offset = w * 7 + (days - 1 - d);
      const date = dateFromOffset(offset);

      // 고정된 패턴으로 더미 데이터 생성 (시드 기반)
      const seed = date.split("-").join(""); // YYYYMMDD 형태로 변환
      const hash = seed.split("").reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);

      let value = 0;
      const random = Math.abs(hash) % 100;

      // 최근 3개월은 더 활발한 활동
      if (offset < 90) {
        if (d >= 1 && d <= 5) {
          // 평일
          value = random < 20 ? 0 : random < 50 ? 1 : random < 80 ? 2 : 3;
        } else {
          // 주말
          value = random < 40 ? 0 : random < 70 ? 1 : 2;
        }
      } else if (offset < 180) {
        if (d >= 1 && d <= 5) {
          value = random < 30 ? 0 : random < 60 ? 1 : 2;
        } else {
          value = random < 50 ? 0 : 1;
        }
      } else {
        value = random < 60 ? 0 : 1;
      }

      cells.push({
        date,
        value: Math.min(3, value), // 최대 3레벨 (0-3)
      });
    }
  }
  const [period, setPeriod] = useState<"today" | "7d">("today");
  const callDist =
    period === "today"
      ? [
          { bucket: "0", count: 4 },
          { bucket: "1", count: 7 },
          { bucket: "2", count: 5 },
          { bucket: "3", count: 8 },
          { bucket: "4", count: 6 },
          { bucket: "5", count: 3 },
          { bucket: "6", count: 2 },
          { bucket: "7", count: 4 },
          { bucket: "8", count: 5 },
          { bucket: "9", count: 1 },
        ]
      : [
          { bucket: "0", count: 22 },
          { bucket: "1", count: 31 },
          { bucket: "2", count: 18 },
          { bucket: "3", count: 26 },
          { bucket: "4", count: 20 },
          { bucket: "5", count: 17 },
          { bucket: "6", count: 9 },
          { bucket: "7", count: 13 },
          { bucket: "8", count: 15 },
          { bucket: "9", count: 6 },
        ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌: 잔디(히트맵) */}
      <Card className="rounded-2xl col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">기여도 히트맵 (1년)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {/* 요일 라벨 (GitHub 스타일) */}
            <div className="flex flex-col justify-around text-xs text-muted-foreground py-1">
              {["", "M", "", "W", "", "F", ""].map((day, index) => (
                <div key={index} className="h-3 flex items-center text-xs">
                  {day}
                </div>
              ))}
            </div>

            {/* 히트맵 그리드 */}
            <div
              className="flex-1 overflow-x-auto"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {/* 월 표시 */}
              <div className="flex mb-2 text-xs text-muted-foreground">
                {Array.from({ length: 53 }).map((_, wi) => {
                  const offset = wi * 7;
                  const date = new Date();
                  date.setDate(date.getDate() - offset);
                  const month = date.getMonth();
                  const isFirstWeekOfMonth = date.getDate() <= 7;

                  if (isFirstWeekOfMonth) {
                    const monthNames = [
                      "1월",
                      "2월",
                      "3월",
                      "4월",
                      "5월",
                      "6월",
                      "7월",
                      "8월",
                      "9월",
                      "10월",
                      "11월",
                      "12월",
                    ];
                    return (
                      <div key={wi} className="flex-1 text-center">
                        {monthNames[month]}
                      </div>
                    );
                  }
                  return <div key={wi} className="flex-1"></div>;
                })}
              </div>

              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(53, minmax(10px, 1fr))` }}
              >
                {Array.from({ length: 53 }).map((_, wi) => (
                  <div key={wi} className="grid grid-rows-7 gap-1">
                    {cells.slice(wi * 7, wi * 7 + 7).map((c, di) => {
                      const sel = selectedDate === c.date;
                      const level = c.value; // 0~4
                      return (
                        <button
                          key={c.date + di}
                          title={`${c.date} • 활동:${level}`}
                          onClick={() => onSelectDate(c.date)}
                          className={`h-3 w-3 rounded-sm border transition-all hover:scale-110 ${
                            sel ? "ring-2 ring-emerald-500" : ""
                          } ${
                            level === 0
                              ? "bg-gray-200" // 활동 없음
                              : level === 1
                              ? "bg-green-300" // 낮은 활동
                              : level === 2
                              ? "bg-green-500" // 중간 활동
                              : "bg-green-900" // 높은 활동
                          }`}
                          style={{
                            border: "1px solid rgba(27, 31, 36, 0.08)",
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 범례 (GitHub 스타일) */}
          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>Less</span>
            <div className="flex items-center gap-1">
              <div
                className="h-3 w-3 rounded-sm"
                style={{
                  backgroundColor: "#f1f3f4",
                  border: "1px solid rgba(27, 31, 36, 0.08)",
                }}
              ></div>
              <div
                className="h-3 w-3 rounded-sm"
                style={{
                  backgroundColor: "#a7f3d0",
                  border: "1px solid rgba(27, 31, 36, 0.08)",
                }}
              ></div>
              <div
                className="h-3 w-3 rounded-sm"
                style={{
                  backgroundColor: "#34d399",
                  border: "1px solid rgba(27, 31, 36, 0.08)",
                }}
              ></div>
              <div
                className="h-3 w-3 rounded-sm"
                style={{
                  backgroundColor: "#10b981",
                  border: "1px solid rgba(27, 31, 36, 0.08)",
                }}
              ></div>
            </div>
            <span>More</span>
          </div>

          <p className="text-xs text-muted-foreground mt-2">
            날짜 칸을 클릭하면 KPI가 해당 일자 기준으로 갱신됩니다.
          </p>
        </CardContent>
      </Card>

      {/* 우: 청구기호 첫째자리 분포 파이 + 기간 토글 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-base">
            청구기호 분포(첫째 자리 0-9)
          </CardTitle>
          <div className="flex gap-2 text-sm">
            <Button
              variant={period === "today" ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              onClick={() => setPeriod("today")}
            >
              금일
            </Button>
            <Button
              variant={period === "7d" ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              onClick={() => setPeriod("7d")}
            >
              최근 7일
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                dataKey="count"
                data={callDist}
                nameKey="bucket"
                outerRadius={80}
                label
              >
                {callDist.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      [
                        "#3b82f6", // 파란색
                        "#10b981", // 초록색
                        "#f59e0b", // 주황색
                        "#ef4444", // 빨간색
                        "#8b5cf6", // 보라색
                        "#06b6d4", // 청록색
                        "#84cc16", // 라임색
                        "#f97316", // 오렌지색
                        "#ec4899", // 핑크색
                        "#6366f1", // 인디고색
                      ][index % 10]
                    }
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------
// 5) 테이블 + 검토/수정 모달
// ---------------------------

function ClusterTable({ rows }: { rows: ClusterRow[] }) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [target, setTarget] = useState<ClusterRow | null>(null);
  const [searchMode, setSearchMode] = useState<"title" | "author">("title");

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          책 별 Work(저작) 클러스터링 결과
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-4">Book ID</th>
                <th className="py-2 pr-4">서명</th>
                <th className="py-2 pr-4">저자</th>
                <th className="py-2 pr-4">Work ID</th>
                <th className="py-2 pr-4">액션</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bookId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono">{r.bookId}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.title}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.author}</td>
                  <td className="py-2 pr-4 font-mono">{r.workId}</td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl bg-transparent"
                        onClick={() => {
                          setTarget(r);
                          setOpen(true);
                          setEditMode(false);
                        }}
                      >
                        검토
                      </Button>
                      <Button size="sm" className="rounded-xl">
                        확정
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 검토/수정 모달 */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className={`max-w-4xl ${editMode ? "md:max-w-6xl" : ""}`}
          >
            <DialogHeader>
              <DialogTitle>
                Work 검토{target ? ` — ${target.title}` : ""}
              </DialogTitle>
            </DialogHeader>
            <div
              className={`grid gap-4 ${
                editMode ? "md:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {/* 1단계: 검토 패널 */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  현재 배정 Work 상세
                </div>
                <div className="rounded-xl border p-3 text-sm space-y-1">
                  <div>
                    <span className="font-medium">장르:</span> 예) SF, 추리
                  </div>
                  <div>
                    <span className="font-medium">특별한 매력:</span> 세계관
                    몰입, 캐릭터 아크
                  </div>
                  <div>
                    <span className="font-medium">핵심 주제:</span> 정체성, 윤리
                  </div>
                  <div>
                    <span className="font-medium">주요 인물:</span> 주인공 A,
                    조력자 B
                  </div>
                </div>
                {!editMode && (
                  <Button
                    className="rounded-xl"
                    onClick={() => setEditMode(true)}
                  >
                    Work 수정
                  </Button>
                )}
              </div>

              {/* 2단계: 오른쪽으로 확장되는 수정 패널 */}
              {editMode && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={searchMode === "title" ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => setSearchMode("title")}
                    >
                      Title
                    </Button>
                    <Button
                      size="sm"
                      variant={searchMode === "author" ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => setSearchMode("author")}
                    >
                      Author
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder={
                        searchMode === "title"
                          ? "제목으로 Work 검색"
                          : "저자로 Work 검색"
                      }
                      className="rounded-xl"
                    />
                    <Button className="rounded-xl">검색</Button>
                  </div>
                  <div className="rounded-xl border p-3 text-sm">
                    <div className="mb-2 text-muted-foreground">검색 결과</div>
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      <li className="flex items-center justify-between">
                        <span>W-123 · 예시 Work 제목</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl bg-transparent"
                        >
                          이 Work로 배정
                        </Button>
                      </li>
                      <li className="flex items-center justify-between">
                        <span>W-456 · 또 다른 Work</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl bg-transparent"
                        >
                          이 Work로 배정
                        </Button>
                      </li>
                    </ul>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">적합한 Work가 없나요?</div>
                    <Button size="sm" className="rounded-xl">
                      새 Work 생성하기
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl bg-transparent"
                onClick={() => setOpen(false)}
              >
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---------------------------
// 6) 메인 대시보드
// ---------------------------

export default function FRBRDashboard() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const kpiKey = selectedDate
    ? `/api/frbr/kpi?date=${selectedDate}`
    : "/api/frbr/kpi?date=today";
  const {
    data: kpiData,
    error: kpiError,
    mutate,
  } = useSWR<KPIResponse>(kpiKey, fetcher);
  const kpi =
    kpiData ?? (selectedDate ? generateKPIData(selectedDate) : mockKPI);

  const { data: clusterRows, error: clusterError } = useSWR<ClusterRow[]>(
    "/api/frbr/clusters?limit=50",
    fetcher
  );
  const rows = clusterRows ?? mockClusterRows;

  useEffect(() => {}, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            서지 정보 관리 대시보드
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            매일 새롭게 들어오는 데이터를 정규화하고, 저작(Work) 기준으로
            관리합니다.
          </p>
        </div>
        <Button className="rounded-xl" onClick={() => mutate()}>
          <RefreshCcw className="h-4 w-4 mr-2" />
          데이터 새로고침
        </Button>
      </header>

      <FilterBar onRefresh={() => mutate()} />

      <KPICards kpi={kpi} />

      <ProgressCards progressData={mockProgressData} />

      <TrendBarChart kpi={kpi} />

      <HeatmapSection
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <ClusterMeta />

      <ClusterTable rows={rows} />
    </div>
  );
}

function ClusterMeta() {
  const [period, setPeriod] = useState<"today" | "7d">("today");
  const { data, error } = useSWR<ClusterSummaryNew>(
    `/api/frbr/cluster-summary?period=${period}`,
    fetcher
  );
  const s = data ?? {
    date: new Date().toISOString().slice(0, 10),
    period,
    totalIn: 420,
    assigned: 388,
    unassigned: 32,
  };

  // 운영 메모 CRUD 기능
  const [memos, setMemos] = useState<MemoItem[]>([
    {
      id: "1",
      content: "어제 대비 Work 증가는 저작 병합/분할 검토 필요.",
      createdAt: "2024-01-15T09:00:00Z",
      updatedAt: "2024-01-15T09:00:00Z",
    },
    {
      id: "2",
      content: "FRBR 생성 건수 급감 시 파이프라인 점검.",
      createdAt: "2024-01-14T14:30:00Z",
      updatedAt: "2024-01-14T14:30:00Z",
    },
    {
      id: "3",
      content: "신뢰도 하락 시 동형어/동명이인 처리 룰 업데이트.",
      createdAt: "2024-01-13T11:15:00Z",
      updatedAt: "2024-01-13T11:15:00Z",
    },
  ]);

  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newMemoContent, setNewMemoContent] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 3;

  // 메모 CRUD 함수들
  const handleEditMemo = (memo: MemoItem) => {
    setEditingMemoId(memo.id);
    setEditingContent(memo.content);
  };

  const handleSaveEdit = () => {
    if (editingMemoId) {
      setMemos((prev) =>
        prev.map((memo) =>
          memo.id === editingMemoId
            ? {
                ...memo,
                content: editingContent,
                updatedAt: new Date().toISOString(),
              }
            : memo
        )
      );
      setEditingMemoId(null);
      setEditingContent("");
    }
  };

  const handleCancelEdit = () => {
    setEditingMemoId(null);
    setEditingContent("");
  };

  const handleDeleteMemo = (id: string) => {
    setMemos((prev) => prev.filter((memo) => memo.id !== id));
  };

  const handleAddNewMemo = () => {
    if (newMemoContent.trim()) {
      const newMemo: MemoItem = {
        id: Date.now().toString(),
        content: newMemoContent.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setMemos((prev) => [newMemo, ...prev]);
      setNewMemoContent("");
      setIsAddingNew(false);
    }
  };

  const handleCancelAdd = () => {
    setNewMemoContent("");
    setIsAddingNew(false);
  };

  // 시간 포맷팅 함수
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 페이지네이션 계산
  const totalPages = Math.ceil(memos.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentMemos = memos.slice(startIndex, endIndex);

  // 페이지 변경 함수
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setEditingMemoId(null); // 편집 모드 종료
    setIsAddingNew(false); // 새 메모 추가 모드 종료
  };

  // 파이차트 데이터 준비 (useMemo로 최적화)
  const pieData = useMemo(
    () => [
      {
        name: "배정됨",
        value: s.assigned,
        color: "#059669", // emerald-600 - 더 진한 초록
        percentage: ((s.assigned / s.totalIn) * 100).toFixed(1),
      },
      {
        name: "미배정",
        value: s.unassigned,
        color: "#ea580c", // orange-600 - 주황색 계열
        percentage: ((s.unassigned / s.totalIn) * 100).toFixed(1),
      },
    ],
    [s.assigned, s.unassigned, s.totalIn]
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">
            Work 클러스터링 요약
          </CardTitle>
          <div className="flex gap-2 text-sm">
            <Button
              variant={period === "today" ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              onClick={() => setPeriod("today")}
            >
              금일
            </Button>
            <Button
              variant={period === "7d" ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              onClick={() => setPeriod("7d")}
            >
              최근 7일
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 파이차트 섹션 */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={30}
                  label={({ name, percentage }) => {
                    const shortName = name === "배정됨" ? "배정" : "미배정";
                    return `${shortName}\n${percentage}%`;
                  }}
                  labelLine={false}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value.toLocaleString(), name]}
                  labelStyle={{ color: "#374151" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* 통계 정보 */}
          <div className="space-y-3">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {s.totalIn.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600">총 반입된 도서 수</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="text-xl font-bold text-emerald-800">
                  {s.assigned.toLocaleString()}
                </div>
                <div className="text-xs text-emerald-700 font-medium">
                  배정됨
                </div>
                <div className="text-xs text-emerald-600">
                  {((s.assigned / s.totalIn) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-xl border border-orange-100">
                <div className="text-xl font-bold text-orange-800">
                  {s.unassigned.toLocaleString()}
                </div>
                <div className="text-xs text-orange-700 font-medium">
                  미배정
                </div>
                <div className="text-xs text-orange-600">
                  {((s.unassigned / s.totalIn) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl md:col-span-2">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">운영 메모</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl bg-transparent"
            onClick={() => setIsAddingNew(true)}
          >
            <Plus className="h-4 w-4 mr-2" />새 메모
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 새 메모 추가 */}
          {isAddingNew && (
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="space-y-3">
                <div className="text-sm font-medium text-blue-800">
                  새 메모 추가
                </div>
                <textarea
                  className="w-full min-h-[80px] rounded-lg border border-blue-300 p-3 bg-white text-sm"
                  placeholder="새로운 운영 메모를 입력하세요..."
                  value={newMemoContent}
                  onChange={(e) => setNewMemoContent(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="rounded-lg bg-blue-600 hover:bg-blue-700"
                    onClick={handleAddNewMemo}
                    disabled={!newMemoContent.trim()}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    저장
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg bg-transparent border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={handleCancelAdd}
                  >
                    <X className="h-4 w-4 mr-2" />
                    취소
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 메모 목록 */}
          <div className="space-y-3">
            {currentMemos.map((memo) => (
              <div
                key={memo.id}
                className="p-4 bg-gray-50 rounded-xl border border-gray-200"
              >
                {editingMemoId === memo.id ? (
                  // 편집 모드
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-gray-700">
                      메모 편집
                    </div>
                    <textarea
                      className="w-full min-h-[80px] rounded-lg border border-gray-300 p-3 bg-white text-sm"
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="rounded-lg bg-green-600 hover:bg-green-700"
                        onClick={handleSaveEdit}
                        disabled={!editingContent.trim()}
                      >
                        <Save className="h-4 w-4 mr-2" />
                        저장
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg bg-transparent border-gray-300 text-gray-700 hover:bg-gray-50"
                        onClick={handleCancelEdit}
                      >
                        <X className="h-4 w-4 mr-2" />
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  // 보기 모드
                  <div className="space-y-3">
                    <div className="text-sm text-gray-800 leading-relaxed">
                      {memo.content}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        생성: {formatDateTime(memo.createdAt)}
                        {memo.updatedAt !== memo.createdAt && (
                          <span className="ml-2">
                            • 수정: {formatDateTime(memo.updatedAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg bg-transparent border-gray-300 text-gray-700 hover:bg-gray-50"
                          onClick={() => handleEditMemo(memo)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg bg-transparent border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => handleDeleteMemo(memo.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {memos.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-sm">아직 등록된 메모가 없습니다.</div>
              <div className="text-xs mt-1">새 메모를 추가해보세요.</div>
            </div>
          )}

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="text-sm text-gray-500">
                {startIndex + 1}-{Math.min(endIndex, memos.length)} /{" "}
                {memos.length}개
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg bg-transparent border-gray-300 text-gray-700 hover:bg-gray-50"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="flex gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (page) => (
                      <Button
                        key={page}
                        variant={currentPage === page ? "default" : "outline"}
                        size="sm"
                        className={`rounded-lg ${
                          currentPage === page
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-transparent border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                        onClick={() => handlePageChange(page)}
                      >
                        {page}
                      </Button>
                    )
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg bg-transparent border-gray-300 text-gray-700 hover:bg-gray-50"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------
// 7) 순수 함수 & 간단 테스트 (추가)
// ---------------------------
// NOTE: UI와 무관한 간단한 유틸을 추가하고, 실행 환경에서 콘솔 단위 테스트를 수행합니다.
// 기존 테스트 케이스가 없었기 때문에 최소한의 검증을 추가합니다 (UI 동작에는 영향 없음).

export function _calcUnassigned(totalIn: number, assigned: number) {
  return Math.max(0, totalIn - assigned);
}

if (typeof window === "undefined" || process.env.NODE_ENV !== "production") {
  // 테스트 케이스
  console.assert(_calcUnassigned(100, 70) === 30, "unassigned should be 30");
  console.assert(_calcUnassigned(10, 10) === 0, "unassigned should be 0");
  console.assert(
    _calcUnassigned(5, 9) === 0,
    "unassigned should not be negative"
  );
}
