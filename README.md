# CAN Crab
This is a rust based project for recording and visualizing CAN data. Primarily this is aimed at improving my understanding of how rust works and getting more experience with the separation of a backend and a front end.

## Learning Objectives
- [ ] 🦀 Fundamentals of rust
- [ ] Websocket communication
- [ ] Backend / Frontend differentiation

## Features

- [ ] DBC (CAN database) file parser
- [ ] [MDF4](https://www.asam.net/standards/detail/mdf/) file format recorder and decoder
- [ ] UI for live plotting and recording

## Application Design
The application will have a backend written in rust for the handling of data - parsing dbc, recording, etc. It will communicate the data to a frontend written in angular via a websocket.

### Backend:
- [tokio](https://tokio.rs/)
- [axum](https://docs.rs/axum/latest/axum/)
- [socketCAN](https://github.com/socketcan-rs/socketcan-rs/blob/master/examples/tokio_print_frames.rs)

### Frontend:
- [angular]
- [highchart.js] or [chart.js] or [plotly.js] or [scichart.js](https://www.scichart.com/demo/javascript) or write something in [WASM](https://wasmbyexample.dev/examples/reading-and-writing-graphics/reading-and-writing-graphics.rust.en-us.html)

# Setup
I'll need a couple tools:
- `can-utils`
- [bruno](https://www.usebruno.com/downloads)

## Setup
Run the backend
```bash
rust run --bin cancrab
```

Run the frontend
```bash
npm start -- --proxy-config proxy.conf.json
```

Navigate to http://localhost:4200/ws-demo