'use strict';

Module.register("mmm-trafikverket-commute", {
    requiresVersion: "2.1.0",
    defaults: {
        api_key: "YOUR_API_KEY", //obtain from https://api.trafikinfo.trafikverket.se/Account/Register
        station_from: "Stockholm C", //your home station. See 'station_id_cache.json' for valid names
        station_to: "Göteborg C", //your destination station. Use a nearby station if you dont get any results
        departures: 8, //number of departures from your home station to show
        pre_stations: 2, //number of stations before your home station to show
        show_track: true, //show track numbers
        show_other_information: false, //show less important information
        show_update_timer: true //show time since last update received
    },
    
    current_train: undefined,
    last_update_time: undefined,
    _clock_id: undefined,
    _highlights: [],
    _main_node: undefined,
    
    getStyles: function () {
		return ["commute.css"];
	},

    getScripts: function () {
        return [
            this.file('moment.min.js')
        ];
    },
    
    start: function () {
    },
    
    getHeader: function () {
        //return "Trafikverket Commute";
    },
    
    getDom: function () {
        if (this._main_node == undefined) {
            this._main_node = document.createElement("div");
            const table = document.createElement("table");
            table.id = "main_table";
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.id = "main_title";
            cell.className = "title";
            cell.colSpan = "5";
            cell.innerHTML = this.config.station_from + " to " + this.config.station_to
            row.appendChild(cell);
            table.appendChild(row);
            const clock_row = document.createElement("tr");
            const clock_cell = document.createElement("td");
            clock_cell.id = "clock";
            clock_cell.className = "update_timer";
            clock_cell.colSpan = "5";
            clock_row.appendChild(clock_cell);
            table.appendChild(clock_row);
            this._main_node.appendChild(table);
        }
        return this._main_node;
    },
    
    initialize: function () {
        this.sendSocketNotification('INITIALIZE', this.config);
        if (this.config.show_update_timer) this._clock_id = setInterval(() => {this.update_clock()}, 1000);
        setInterval(() => {this.highlight_update()}, 500);
    },
    
    updateDepartures: function (departures) {
        this.last_update_time = moment();
        
        //keep current train info updated
        if (this.current_train == undefined || this.current_train.AdvertisedTrainIdent == departures[0].AdvertisedTrainIdent)
            this.current_train = departures[0];
        
        const start_fade = 2;
        const step = 1.0/((this.config.departures-start_fade)*3);
        let opacity = 1.0+(start_fade*3*step); //values above 1.0 will be clamped
        departures.forEach(dep => {
            this.update_announcement_row(dep, false).forEach(row => {
                row.style.opacity = opacity;
                opacity = opacity - step;
            });
        });
    },
    
    updatePreStations: function (pre_stations) {
        this.last_update_time = moment();
        
        pre_stations.forEach(dep => {
            this.update_announcement_row(dep, true);
        });
    },
    
    update_announcement_row: function (elm, is_pre_station) {
        let rows = this.get_announcement_rows(elm.LocationSignature+elm.AdvertisedTrainIdent, is_pre_station);
        rows[0].children[1].classList.remove("delayed");
        let message = "on time";
        if (Object.hasOwn(elm, "EstimatedTimeAtLocation")) {
            message = "delayed";
            rows[0].children[1].classList.add("delayed");
        }
        let deviations = Object.hasOwn(elm, "Deviation") ? elm.Deviation.filter(dev => {
            if (dev.Code == "ANA088") {
                message = "await time";
                rows[0].children[1].classList.add("delayed");
                return false;
            }
            if (dev.Code == "ANA046") {
                message = "prel time";
                rows[0].children[1].classList.add("delayed");
                return false;
            }
            if (dev.Code == "ANA027") {
                message = "canceled";
                rows[0].children[1].classList.add("delayed");
                return false;
            }
            if (is_pre_station && Object.hasOwn(this.current_train, "Deviation")) {
                //do not show same deviation messages as already shown under departures
                if (this.current_train.Deviation.map(d => d.Code).includes(dev.Code)) return false;
            }
            return true;
        }) : [];
        if (Object.hasOwn(elm, "ArrivedTimeAtLocationWithSeconds")) message = "arrived";
        if (Object.hasOwn(elm, "TimeAtLocationWithSeconds")) message = "departed";
        if (elm.Canceled) {
            message = "CANCELED";
            rows[0].children[1].classList.add("delayed");
        }

        let time = Object.hasOwn(elm, "EstimatedTimeAtLocation") ? moment(elm.EstimatedTimeAtLocation).format("HH:mm"): "";
        if (Object.hasOwn(elm, "ArrivedTimeAtLocationWithSeconds")) time = moment(elm.ArrivedTimeAtLocationWithSeconds).format("HH:mm:ss");
        if (Object.hasOwn(elm, "TimeAtLocationWithSeconds")) time = moment(elm.TimeAtLocationWithSeconds).format("HH:mm:ss");

        rows[0].children[0].innerHTML = is_pre_station ? elm.AdvertisedLocationName : elm.AdvertisedTrainIdent;
        rows[0].children[1].innerHTML = moment(elm.AdvertisedTimeAtLocation).format("HH:mm");
        if (message != rows[0].children[2].innerHTML) this.highlight(rows[0].children[2]);
        rows[0].children[2].innerHTML = message;
        if (time != rows[0].children[3].innerHTML) this.highlight(rows[0].children[3]);
        rows[0].children[3].innerHTML = time;
        rows[0].children[4].innerHTML = this.config.show_track ? elm.TrackAtLocation : "";
        rows[1].children[0].innerHTML = deviations.map(dev => dev.Description).join(" - ");
        //TODO filter out duplicate messages from current train
        rows[2].children[0].innerHTML = this.config.show_other_information ? Object.hasOwn(elm, "OtherInformation") ? elm.OtherInformation.map(dev => dev.Description).join(" - ") : "" : "";
        return rows;
    },
    
    get_announcement_rows: function (row_id, is_pre_station) {
        let rows = document.getElementById(row_id);
        if (rows == undefined) {
            rows = this.create_announcement_rows(row_id, is_pre_station);
            rows[0].id = row_id;
            rows[1].id = row_id+"deviation";
            rows[2].id = row_id+"otherInformation";
        } else {
            rows = [rows];
            rows.push(document.getElementById(row_id+"deviation"));
            rows.push(document.getElementById(row_id+"otherInformation"));
        }
        return rows;
    },
    
    create_announcement_rows: function (row_id, is_pre_station) {
        const table = document.getElementById("main_table");
        let rows = [];
        let row = document.createElement("tr");
        let cell = document.createElement("td");
        cell.id = row_id+"trainId";
        cell.className = "trainId light";
        row.appendChild(cell);
        cell = document.createElement("td");
        cell.id = row_id+"scheduleTime";
        cell.className = "scheduleTime bright light";
        row.appendChild(cell);
        cell = document.createElement("td");
        cell.id = row_id+"message";
        cell.className = "message light";
        row.appendChild(cell);
        cell = document.createElement("td");
        cell.id = row_id+"acctualTime";
        cell.className = "acctualTime bright light";
        row.appendChild(cell);
        cell = document.createElement("td");
        cell.id = row_id+"track";
        cell.className = "track light";
        row.appendChild(cell);
        row.className = is_pre_station ? "pre_station" : "departure_row";
        rows.push(row);
        is_pre_station ? table.insertBefore(row, table.children[0]) : table.appendChild(row);

        row = this.create_text_row(table);
        row.className = is_pre_station ? "pre_station deviation" : "departure_row deviation";
        rows.push(row);
        is_pre_station ? table.insertBefore(row, table.children[1]) : table.appendChild(row);

        row = this.create_text_row(table);
        row.className = is_pre_station ? "pre_station otherInformation" : "departure_row otherInformation";
        rows.push(row);
        is_pre_station ? table.insertBefore(row, table.children[2]) : table.appendChild(row);

        return rows;
    },
    
    create_text_row: function (table) {
        let row = document.createElement("tr");
        let cell = document.createElement("td");
        cell.colSpan = "5";
        row.appendChild(cell);
        table.appendChild(row);
        return row;
    },
    
    highlight: function (elm) {
        const index = this._highlights.map(e => e.element.id).indexOf(elm.id);
        if (index >= 0) this._highlights.splice(index, 1);
        this._highlights.push({element: elm, ticks: 20});
    },

    highlight_update: function () {
        this._highlights.forEach(elm => {
            elm.element.classList.toggle("bright");
            elm.ticks--;
        });
        while (this._highlights.length > 0 && this._highlights[0].ticks < 1) {
            this._highlights.shift();
        }
    },
    
    update_clock: function () {
        if (this.last_update_time) {
            document.getElementById("clock").innerHTML = `Trafikverket - time since last update ${moment(moment().diff(this.last_update_time)).format("mm:ss")}`;
        }
    },
    
    notificationReceived: function (notification, payload) {
        if (notification === "MODULE_DOM_CREATED") {
            this.initialize();
        }
    },
    
    socketNotificationReceived: function (notification, payload) {
        switch (notification) {
            case "GOT_DEPARTURES_UPDATE":
                this.updateDepartures(payload);
                break;
            case "GOT_PRE_STATIONS_UPDATE":
                this.updatePreStations(payload);
                break;
            case "CLEAR_TABLE":
                Array.from(document.getElementsByClassName("departure_row")).forEach(elm => elm.remove());
                Array.from(document.getElementsByClassName("pre_station")).forEach(elm => elm.remove());
                break;
            default:
                Log.info("Commute unhandled notification "+notification);
        }
    },
});
