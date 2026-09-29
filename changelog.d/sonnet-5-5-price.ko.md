### 변경
- FUEL 가격표(`server/fuel-prices.json`)에 `claude-sonnet-5-5`를 정가로 넣었다(입력 $2, 출력 $10, 캐시 읽기 0.1×, Sonnet 5와 같다). 가격은 모델 이름이 정확히 맞을 때만 매기므로, 전에는 그 요청이 가격 없음으로 잡혔다([docs/fuel.md](docs/fuel.md) 8.4).
