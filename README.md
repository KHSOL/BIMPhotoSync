# BIM Photo Sync

BIM Photo Sync는 Revit Room을 기준 객체로 삼아 현장 사진, 작업 메모, AI 분석 결과를 프로젝트 단위로 연결하는 BIM 기반 현장 사진 관리 플랫폼입니다. 현장에 없던 사람도 웹과 앱, Revit Add-in을 통해 특정 실의 시공 상황을 시간 순서대로 확인할 수 있도록 만드는 것이 핵심 목적입니다.

## 프로젝트 목표

1차 MVP의 목표는 도면 연동 사진 업로드 프로그램 개발과 사진 분석 프로세스 정립입니다.

- 회사 단위 로그인/회원가입과 프로젝트 데이터 분리
- Revit Room과 플랫폼 Room의 안정적인 매핑
- 프로젝트, 실, 공사면, 공종, 작업일자, 작성자, 내용 기반 사진 업로드 및 조회
- 업로드 사진에 대한 기본 AI 분석 및 분석 내용 저장
- Revit에서 Room 선택 시 `BIM_PHOTO_ROOM_ID` 기준으로 해당 Room 사진 조회
- 웹과 모바일에서 동일한 Backend DB를 바라보는 공동 관리 흐름

## 핵심 원칙

- Room은 시스템의 기준 객체입니다.
- Backend DB가 source of truth입니다.
- Revit은 BIM authoring tool이며 데이터베이스가 아닙니다.
- Room 매핑은 이름이 아니라 `BIM_PHOTO_ROOM_ID`로 수행합니다.
- Revit 모델 수정은 External Event를 통해서만 수행합니다.
- Revit Add-in UI는 Dockable Panel을 사용합니다.

## 시스템 구성

```text
현장 사용자
  -> 모바일/웹에서 프로젝트와 Room 선택
  -> 사진, 공사면, 공종, 작업일자, 작업자, 메모 입력
  -> Backend API에 업로드 요청
  -> Object Storage에 사진 저장
  -> Backend DB에 메타데이터 저장
  -> AI Worker가 사진 분석
  -> 웹/앱/Revit Add-in에서 Room 기준 조회
```

```text
Revit 사용자
  -> Revit Add-in에서 프로젝트 연결
  -> Room Sync 실행
  -> Revit Room에 BIM_PHOTO_ROOM_ID 기록
  -> Room 선택
  -> Dockable Panel이 Backend API 호출
  -> 해당 Room 사진을 최신순으로 표시
```

## Repository Structure

```text
apps/api
  Backend API. 인증, 회사/프로젝트, Room, 사진 업로드, 사진 조회,
  AI 분석 결과, Revit 연동 API를 담당합니다.

apps/ai-worker
  사진 분석 작업을 처리하는 worker입니다.
  업로드된 사진을 분석하고 요약 내용을 DB에 저장합니다.

apps/web
  웹 관리자/조회 화면입니다.
  로그인, 프로젝트, Room, 사진 조회와 업로드 흐름을 제공합니다.

apps/mobile
  현장 사진 촬영/선택, 메타데이터 입력, 업로드를 위한 모바일 앱 영역입니다.

packages/shared
  앱, 웹, API, worker가 함께 사용하는 타입과 공통 정의를 담습니다.

revit-addin/BimPhotoSyncAddin
  Revit 2025용 Add-in 코드입니다.
  프로젝트 연결, Room Sync, Dockable Panel 사진 조회를 담당합니다.

revit-addin/BimPhotoSync.addin
  Revit Add-in manifest입니다.

revit-addin/config.example.json
  Add-in 실행에 필요한 API URL, JWT, Project ID, Revit Model ID 설정 예시입니다.
```

## 주요 데이터 흐름

### 1. 회사/프로젝트 단위 접근

사용자는 회사명과 계정 정보로 가입합니다. 데이터는 회사와 프로젝트 기준으로 분리되며, 프로젝트에 접근 가능한 사용자만 Room과 사진 정보를 조회합니다.

### 2. Room 중심 사진 저장

모든 사진은 프로젝트와 Room에 연결됩니다. 사진 메타데이터는 공사면, 공종, 작업일자, 작성자, 설명, AI 분석 내용으로 구성됩니다.

### 3. AI 분석

사진 업로드 후 worker가 분석 작업을 수행합니다. 분석 결과는 사람이 검토할 수 있는 설명과 상태 정보로 저장되며, 이후 보고서 생성과 품질 검토의 기반 데이터가 됩니다.

### 4. Revit 연동

Revit Add-in은 Revit Room을 수집해 Backend Room과 동기화합니다. 각 Revit Room에는 `BIM_PHOTO_ROOM_ID` shared parameter가 기록되고, 사용자가 Room을 선택하면 Add-in Dockable Panel이 해당 ID로 사진 API를 호출합니다.

## 현재 MVP 범위

완성 대상으로 보는 범위는 다음 네 가지입니다.

- 로그인/회원가입 및 회사 단위 데이터 분리
- Revit Room 기반 도면 연동 및 Room Sync
- 사진 업로드/조회와 기본 AI 분석 저장
- Revit Room 선택 시 해당 Room 사진을 시간 순서로 표시

## 향후 확장 범위

아래 기능은 1차 MVP 이후의 확장 범위입니다.

- 종합 분석 보고서 자동 생성
- 공정표와 사진 기록 비교 분석
- 도면 위 공정 상태 색상 표시
- AI 분석 정밀화와 반복 학습
- PDF, Word, HWP 등 보고서 출력
- APS Viewer 기반 웹 도면 뷰어

## 사용자 방향성

이 프로젝트의 1차 목적은 복잡한 권한 체계보다 현장 사진을 프로젝트/실/공종 기준으로 쉽게 업로드하고 함께 조회하는 공동 관리 경험입니다. 현장소장, 공무팀, 작업자, 협력업체, 감리, 발주처, CM사는 서로 다른 활용 시나리오를 갖지만, MVP에서는 모든 로그인 사용자가 기본적인 업로드와 조회 흐름을 사용할 수 있는 구조를 우선합니다.
