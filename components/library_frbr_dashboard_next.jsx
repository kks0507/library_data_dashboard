'use client';

// 서지 정보 관리 대시보드 — Next.js (App Router) demo
// --------------------------------------------------
// ✅ 포함 내용
// 1) KPI 카드 4종 (순서: 새로 들어온 데이터 → FRBR 기반 생성 → 새 Work 생성 → Work 총계)
// 2) 1년 잔디(히트맵) + 날짜 클릭 시 KPI 연동
// 3) 청구기호 첫째 자리(0~9) 분포 파이 차트 + [금일/최근7일] 토글
// 4) Work 클러스터링 요약(총 반입/배정/미배정) + [금일/최근7일] 토글
// 5) 운영 메모 편집(수정 버튼으로 textarea 토글)
// 6) 테이블(Cluster/신뢰도/근거 컬럼 제거) + 모달(검토 → 우측 확장 수정, Work 검색/재배정/새 Work 생성)
// ※ shadcn/ui, lucide-react, recharts 사용 가정

import React, { useState, useEffect } from "react";
import useSWR from "swr";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar as CalendarIcon, RefreshCcw, TrendingUp, BookUp, Database, GitBranch } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, PieChart, Pie } from "recharts";

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
  series7d: Array<{ date: string; newWorks: number; newBiblio: number; frbrCreated: number; workTotal: number }>; // 7일 추이 (스파크라인용)
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
  period: 'today'|'7d';
  totalIn: number; // 총 반입된 도서 수
  assigned: number; // Work 배정 수
  unassigned: number; // 미배정 수
};

// ---------------------------
// 1) 페치 유틸 + Mock
// ---------------------------

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const mockKPI: KPIResponse = {
  date: "2025-10-22",
  newWorks: 18,
  newBiblio: 42,
  frbrCreated: 31,
  workTotal: 189234,
  workDeltaD1: 77,
  series7d: [
    { date: "10-16", newWorks: 11, newBiblio: 28, frbrCreated: 15, workTotal: 189000 },
    { date: "10-17", newWorks: 9, newBiblio: 33, frbrCreated: 17, workTotal: 189020 },
    { date: "10-18", newWorks: 13, newBiblio: 21, frbrCreated: 12, workTotal: 189040 },
    { date: "10-19", newWorks: 7, newBiblio: 44, frbrCreated: 25, workTotal: 189080 },
    { date: "10-20", newWorks: 20, newBiblio: 51, frbrCreated: 38, workTotal: 189140 },
    { date: "10-21", newWorks: 16, newBiblio: 35, frbrCreated: 28, workTotal: 189170 },
    { date: "10-22", newWorks: 18, newBiblio: 42, frbrCreated: 31, workTotal: 189234 },
  ],
};

const mockClusterRows: ClusterRow[] = Array.from({ length: 12 }).map((_, i) => ({
  bookId: `B-${1000 + i}`,
  title: `예시 도서 제목 ${i + 1}`,
  author: i % 3 === 0 ? "홍길동" : i % 3 === 1 ? "김철수" : "이영희",
  workId: `W-${500 + Math.floor(i / 2)}`,
}));

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
            <input type="date" className="outline-none" defaultValue={new Date().toISOString().slice(0,10)} />
          </div>
          <Button variant="outline" className="rounded-xl" onClick={onRefresh}>
            <RefreshCcw className="h-4 w-4 mr-2" />새로고침
          </Button>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col">
        <label className="text-sm text-muted-foreground mb-1">검색 (서명/저자)</label>
        <div className="flex gap-2">
          <Input placeholder="예: 파이썬, 홍길동" className="rounded-xl" value={q} onChange={(e)=>setQ(e.target.value)} />
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
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4"/>새로 들어온 데이터</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{kpi.newBiblio.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">biblio(raw) 기준</div>
          <MiniSpark series={kpi.series7d.map(d=>({date:d.date,value:d.newBiblio}))} />
        </CardContent>
      </Card>
      {/* 2) FRBR 기반 생성 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4"/>FRBR 기반 생성</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{kpi.frbrCreated.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">정규화(Work/Expr/Manif) 건수</div>
          <MiniSpark series={kpi.series7d.map(d=>({date:d.date,value:d.frbrCreated}))} />
        </CardContent>
      </Card>
      {/* 3) 새 Work(저작) 생성 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><BookUp className="h-4 w-4"/>새 Work(저작) 생성</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{kpi.newWorks.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">신규 저작 수</div>
          <MiniSpark series={kpi.series7d.map(d=>({date:d.date,value:d.newWorks}))} />
        </CardContent>
      </Card>
      {/* 4) Work 총계 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4"/>Work 총계</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{kpi.workTotal.toLocaleString()}</div>
          <div className="text-xs text-emerald-600 mt-1">어제 대비 +{kpi.workDeltaD1.toLocaleString()}</div>
          <MiniSpark series={kpi.series7d.map(d=>({date:d.date,value:d.workTotal}))} />
        </CardContent>
      </Card>
    </div>
  );
}

function MiniSpark({ series }: { series: Array<{date:string; value:number}> }) {
  return (
    <div className="h-16 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <XAxis hide dataKey="date" />
          <YAxis hide />
          <Tooltip formatter={(v)=>v.toLocaleString()} />
          <Line type="monotone" dataKey="value" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------
// 4) 잔디형(1년) 히트맵 + 청구기호 분포
// ---------------------------

function HeatmapSection({ selectedDate, onSelectDate }: { selectedDate: string | null; onSelectDate: (d: string)=>void }) {
  const weeks = 53; const days = 7;
  function dateFromOffset(offset:number){
    const d = new Date(); d.setDate(d.getDate()-offset); return d.toISOString().slice(0,10);
  }
  const cells: Array<{date:string; value:number}> = [];
  for (let w=weeks-1; w>=0; w--){
    for (let d=0; d<days; d++){
      const offset = w*7 + (days-1-d);
      cells.push({ date: dateFromOffset(offset), value: Math.floor(Math.random()*6) }); // 0~5 단계
    }
  }
  const [period, setPeriod] = useState<'today'|'7d'>('today');
  const callDist = period==='today'
    ? [{bucket:'0',count:4},{bucket:'1',count:7},{bucket:'2',count:5},{bucket:'3',count:8},{bucket:'4',count:6},{bucket:'5',count:3},{bucket:'6',count:2},{bucket:'7',count:4},{bucket:'8',count:5},{bucket:'9',count:1}]
    : [{bucket:'0',count:22},{bucket:'1',count:31},{bucket:'2',count:18},{bucket:'3',count:26},{bucket:'4',count:20},{bucket:'5',count:17},{bucket:'6',count:9},{bucket:'7',count:13},{bucket:'8',count:15},{bucket:'9',count:6}];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌: 잔디(히트맵) */}
      <Card className="rounded-2xl col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">기여도 히트맵 (1년)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-53 gap-1 overflow-x-auto" style={{gridTemplateColumns:`repeat(53,minmax(10px,1fr))`}}>
            {Array.from({length:53}).map((_,wi)=> (
              <div key={wi} className="grid grid-rows-7 gap-1">
                {cells.slice(wi*7, wi*7+7).map((c, di)=>{
                  const sel = selectedDate===c.date;
                  const level = c.value; // 0~5
                  return (
                    <button
                      key={c.date+di}
                      title={`${c.date} • 활동:${level}`}
                      onClick={()=>onSelectDate(c.date)}
                      className={`h-3 w-3 rounded-sm border ${sel? 'ring-2 ring-emerald-500':''}`}
                      style={{opacity: 0.3 + level*0.12}}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">날짜 칸을 클릭하면 KPI가 해당 일자 기준으로 갱신됩니다.</p>
        </CardContent>
      </Card>

      {/* 우: 청구기호 첫째자리 분포 파이 + 기간 토글 */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-base">청구기호 분포(첫째 자리 0-9)</CardTitle>
          <div className="flex gap-2 text-sm">
            <Button variant={period==='today'? 'default':'outline'} size="sm" className="rounded-xl" onClick={()=>setPeriod('today')}>금일</Button>
            <Button variant={period==='7d'? 'default':'outline'} size="sm" className="rounded-xl" onClick={()=>setPeriod('7d')}>최근 7일</Button>
          </div>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie dataKey="count" data={callDist} nameKey="bucket" outerRadius={80} label />
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
  const [searchMode, setSearchMode] = useState<'title'|'author'>('title');

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">책 별 Work(저작) 클러스터링 결과</CardTitle></CardHeader>
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
              {rows.map(r => (
                <tr key={r.bookId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono">{r.bookId}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.title}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{r.author}</td>
                  <td className="py-2 pr-4 font-mono">{r.workId}</td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setTarget(r); setOpen(true); setEditMode(false); }}>검토</Button>
                      <Button size="sm" className="rounded-xl">확정</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 검토/수정 모달 */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className={`max-w-4xl ${editMode? 'md:max-w-6xl':''}`}>
            <DialogHeader>
              <DialogTitle>Work 검토{target ? ` — ${target.title}` : ''}</DialogTitle>
            </DialogHeader>
            <div className={`grid gap-4 ${editMode? 'md:grid-cols-2':'grid-cols-1'}`}>
              {/* 1단계: 검토 패널 */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">현재 배정 Work 상세</div>
                <div className="rounded-xl border p-3 text-sm space-y-1">
                  <div><span className="font-medium">장르:</span> 예) SF, 추리</div>
                  <div><span className="font-medium">특별한 매력:</span> 세계관 몰입, 캐릭터 아크</div>
                  <div><span className="font-medium">핵심 주제:</span> 정체성, 윤리</div>
                  <div><span className="font-medium">주요 인물:</span> 주인공 A, 조력자 B</div>
                </div>
                {!editMode && (
                  <Button className="rounded-xl" onClick={()=>setEditMode(true)}>Work 수정</Button>
                )}
              </div>

              {/* 2단계: 오른쪽으로 확장되는 수정 패널 */}
              {editMode && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant={searchMode==='title'? 'default':'outline'} className="rounded-xl" onClick={()=>setSearchMode('title')}>Title</Button>
                    <Button size="sm" variant={searchMode==='author'? 'default':'outline'} className="rounded-xl" onClick={()=>setSearchMode('author')}>Author</Button>
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder={searchMode==='title'? '제목으로 Work 검색':'저자로 Work 검색'} className="rounded-xl" />
                    <Button className="rounded-xl">검색</Button>
                  </div>
                  <div className="rounded-xl border p-3 text-sm">
                    <div className="mb-2 text-muted-foreground">검색 결과</div>
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      <li className="flex items-center justify-between"><span>W-123 · 예시 Work 제목</span><Button size="sm" variant="outline" className="rounded-xl">이 Work로 배정</Button></li>
                      <li className="flex items-center justify-between"><span>W-456 · 또 다른 Work</span><Button size="sm" variant="outline" className="rounded-xl">이 Work로 배정</Button></li>
                    </ul>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm">적합한 Work가 없나요?</div>
                    <Button size="sm" className="rounded-xl">새 Work 생성하기</Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={()=>setOpen(false)}>닫기</Button>
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
  const kpiKey = selectedDate ? `/api/frbr/kpi?date=${selectedDate}` : "/api/frbr/kpi?date=today";
  const { data: kpiData, error: kpiError, mutate } = useSWR<KPIResponse>(kpiKey, fetcher);
  const kpi = kpiData ?? mockKPI;

  const { data: clusterRows, error: clusterError } = useSWR<ClusterRow[]>("/api/frbr/clusters?limit=50", fetcher);
  const rows = clusterRows ?? mockClusterRows;

  useEffect(()=>{},[]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">서지 정보 관리 대시보드</h1>
          <p className="text-sm text-muted-foreground mt-1">매일 새롭게 들어오는 데이터를 정규화하고, 저작(Work) 기준으로 관리합니다.</p>
        </div>
        <Button className="rounded-xl" onClick={()=>mutate()}>
          <RefreshCcw className="h-4 w-4 mr-2"/>데이터 새로고침
        </Button>
      </header>

      <FilterBar onRefresh={()=>mutate()} />

      <KPICards kpi={kpi} />

      <HeatmapSection selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <ClusterMeta />

      <ClusterTable rows={rows} />
    </div>
  );
}

function ClusterMeta(){
  const [period, setPeriod] = useState<'today'|'7d'>('today');
  const { data, error } = useSWR<ClusterSummaryNew>(`/api/frbr/cluster-summary?period=${period}`, fetcher);
  const s = data ?? { date: new Date().toISOString().slice(0,10), period, totalIn: 420, assigned: 388, unassigned: 32 };

  // 운영 메모 편집 (문자열은 템플릿 리터럴로 안전하게 작성)
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState(`어제 대비 Work 증가는 저작 병합/분할 검토 필요.
FRBR 생성 건수 급감 시 파이프라인 점검.
신뢰도 하락 시 동형어/동명이인 처리 룰 업데이트.`);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-base">Work 클러스터링 요약</CardTitle>
          <div className="flex gap-2 text-sm">
            <Button variant={period==='today'? 'default':'outline'} size="sm" className="rounded-xl" onClick={()=>setPeriod('today')}>금일</Button>
            <Button variant={period==='7d'? 'default':'outline'} size="sm" className="rounded-xl" onClick={()=>setPeriod('7d')}>최근 7일</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>총 반입된 도서 수: <span className="font-medium">{s.totalIn.toLocaleString()}</span></div>
          <div>Work(저작)에 배정된 수: <span className="font-medium">{s.assigned.toLocaleString()}</span></div>
          <div>미배정 수: <span className="font-medium">{s.unassigned.toLocaleString()}</span></div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl md:col-span-2">
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-base">운영 메모</CardTitle>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={()=>setEditing(!editing)}>수정</Button>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-2">
              <textarea className="w-full min-h-[120px] rounded-xl border p-3" value={memo} onChange={(e)=>setMemo(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" className="rounded-xl" onClick={()=>setEditing(false)}>저장</Button>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={()=>setEditing(false)}>취소</Button>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm">{memo}</pre>
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

if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production') {
  // 테스트 케이스
  console.assert(_calcUnassigned(100, 70) === 30, 'unassigned should be 30');
  console.assert(_calcUnassigned(10, 10) === 0, 'unassigned should be 0');
  console.assert(_calcUnassigned(5, 9) === 0, 'unassigned should not be negative');
}

// ---------------------------
// 8) API 스펙(백엔드 가이드, 예시)
// ---------------------------
// GET /api/frbr/kpi?date=YYYY-MM-DD => KPIResponse
// GET /api/frbr/clusters?limit=50&offset=0&date=YYYY-MM-DD => ClusterRow[]
// GET /api/frbr/cluster-summary?period=today|7d => ClusterSummaryNew
//
// * DB 스키마(예시, Prisma 기준):
// model Work { id String @id @default(cuid()) title String? authors String[] createdAt DateTime @default(now()) }
// model Expression { id String @id @default(cuid()) workId String work Work @relation(fields:[workId], references:[id]) language String? createdAt DateTime @default(now()) }
// model Manifestation { id String @id @default(cuid()) expressionId String expression Expression @relation(fields:[expressionId], references:[id]) isbn String? pubYear Int? createdAt DateTime @default(now()) }
// model Item { id String @id @default(cuid()) manifestationId String manifestation Manifestation @relation(fields:[manifestationId], references:[id]) barcode String? location String? createdAt DateTime @default(now()) }
// model BiblioRaw { id String @id @default(cuid()) payload Json ingestedAt DateTime @default(now()) source String? }
// model ClusterAssign { id String @id @default(cuid()) bookId String workId String? assignedAt DateTime @default(now()) }
//
// * 집계 뷰(예):
//  - vw_daily_kpi(date, new_biblio, new_works, frbr_created, work_total)
//  - vw_callnum_dist(date, bucket_0_9_json)
//  - vw_assign_summary(date, total_in, assigned, unassigned)
//
// * 배치 파이프라인(요지):
//  1) Ingest: BiblioRaw 적재 → 정규화(title/author/isbn)
//  2) Match: 규칙+유사도 매칭으로 Work 생성/매핑 → Expression/Manifestation 파생
//  3) Assign Summary: assign 통계 및 청구기호 분포 집계
//  4) Publish: KPI/요약 뷰 갱신
