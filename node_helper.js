'use strict';
const NodeHelper = require('node_helper');
const moment = require('moment');
const Log = require("logger");
const fetch = require("fetch");
const EventSource = require("eventsource");

const _station_cache = require("./station_id_cache.json");

module.exports = NodeHelper.create({
    config: {},
    station_from_id: undefined,
    station_to_id: undefined,
    current_train: undefined,
    current_departures: [],
    current_pre_stations: [],
    pre_station_ids: [],
    dep_es: undefined,
    pre_es: undefined,
    backup_timer_id: undefined,
    _api_url: "https://api.trafikinfo.trafikverket.se/v2/data.json",
    _station_cache: _station_cache,
    
    get_station_name: async function(station_sign) {
        if (!Object.hasOwn(this._station_cache, station_sign)) {
            const xml = `
                <REQUEST>
                    <LOGIN authenticationkey="${this.config.api_key}" />
                    <QUERY objecttype="TrainStation" schemaversion="1">
                        <FILTER>
                            <AND>
                                <EQ name="Advertised" value="true" />
                                <EQ name="LocationSignature" value="${station_sign}" />
                            </AND>
                        </FILTER>
                        <INCLUDE>LocationSignature</INCLUDE>
                        <INCLUDE>AdvertisedLocationName</INCLUDE>
                    </QUERY>
                </REQUEST>`;
            const response = await fetch(this._api_url, {method: 'POST',  body: xml});
            const jsonData = await response.json();
            if (jsonData.RESPONSE.RESULT[0].TrainStation.length < 1) {
                throw Error("Could not find station for signature "+station_sign);
            }
            this._station_cache[station_sign] = jsonData.RESPONSE.RESULT[0].TrainStation[0].AdvertisedLocationName;
        }
        return this._station_cache[station_sign];
    },
    
    get_station_sign: async function(station_name) {
        for (const [key, value] of Object.entries(this._station_cache)) {
            if (value == station_name) return key;
        }
        let xml = `
            <REQUEST>
                <LOGIN authenticationkey="${this.config.api_key}" />
                <QUERY objecttype="TrainStation" schemaversion="1">
                    <FILTER>
                        <AND>
                            <EQ name="Advertised" value="true" />
                            <EQ name="AdvertisedLocationName" value="${station_name}" />
                        </AND>
                    </FILTER>
                    <INCLUDE>LocationSignature</INCLUDE>
                    <INCLUDE>AdvertisedLocationName</INCLUDE>
                </QUERY>
            </REQUEST>`;
        const response = await fetch(this._api_url, {method: 'POST',  body: xml});
        const jsonData = await response.json();
        if (jsonData.RESPONSE.RESULT[0].TrainStation.length < 1) {
            throw Error("Could not find station for name "+station_name);
        }
        const sign = jsonData.RESPONSE.RESULT[0].TrainStation[0].LocationSignature;
        this._station_cache[sign] = station_name;
        return sign;
    },
    
    get_departures_stream: async function() {
        let xml = `
            <REQUEST>
                <LOGIN authenticationkey="${this.config.api_key}" />
                <QUERY objecttype="TrainAnnouncement" schemaversion="1.8" orderby="AdvertisedTimeAtLocation" limit="${this.config.departures*2}" sseurl="true">
                    <FILTER>
                        <AND>
                            <EQ name="Advertised" value="true" />
                            <EQ name="LocationSignature" value="${this.station_from_id}" />
                            <LT name="AdvertisedTimeAtLocation" value="${moment().add(1,"d").add(-1,"m").format()}" />
                            <OR>
                                <GT name="TimeAtLocationWithSeconds" value="${moment().add(-30, "s").format()}" />
                                <GT name="EstimatedTimeAtLocation" value="${moment().add(-30, "s").format()}" />
                                <GT name="AdvertisedTimeAtLocation" value="${moment().add(-30, "s").format()}" />
                            </OR>
                            <OR>
                                <AND>
                                    <EQ name="ActivityType" value="Avgang" />
                                    <OR>
                                        <EQ name="ToLocation.LocationName" value="${this.station_to_id}" />
                                        <EQ name="ViaToLocation.LocationName" value="${this.station_to_id}" />    
                                    </OR>
                                </AND>
                                <AND>
                                    <EQ name="ActivityType" value="Ankomst" />
                                    <NOT>
                                        <OR>
                                            <EQ name="ViaFromLocation.LocationName" value="${this.station_to_id}" />
                                            <EQ name="FromLocation.LocationName" value="${this.station_to_id}" />
                                        </OR>
                                    </NOT>
                                </AND>
                            </OR>
                        </AND>
                    </FILTER>
                    <INCLUDE>ActivityType</INCLUDE>
                    <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                    <INCLUDE>LocationSignature</INCLUDE>
                    <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                    <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
                    <INCLUDE>Canceled</INCLUDE>
                    <INCLUDE>Deviation</INCLUDE>
                    <INCLUDE>TimeAtLocationWithSeconds</INCLUDE>
                    <INCLUDE>PlannedEstimatedTimeAtLocation</INCLUDE>
                    <INCLUDE>PlannedEstimatedTimeAtLocationIsValid</INCLUDE>
                    <INCLUDE>TrackAtLocation</INCLUDE>
                    <INCLUDE>OtherInformation</INCLUDE>
                </QUERY>
            </REQUEST>`;
        let response = await fetch(this._api_url, {method: 'POST',  body: xml});
        return response;
    },
    
    get_pre_stations_stream: async function (train_id, to_time) {
        const xml = `
            <REQUEST>
                <LOGIN authenticationkey="${this.config.api_key}" />
                <QUERY objecttype="TrainAnnouncement" schemaversion="1.8" orderby="AdvertisedTimeAtLocation desc" limit="${this.config.pre_stations*2}" sseurl="true">
                <FILTER>
                    <AND>
                        <EQ name="Advertised" value="true" />
                        <EQ name="AdvertisedTrainIdent" value="${train_id}" />
                        <GT name="AdvertisedTimeAtLocation" value="${moment().add(-15,"h").format()}" />
                        <LT name="AdvertisedTimeAtLocation" value="${to_time}" />
                    </AND>
                </FILTER>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>TimeAtLocationWithSeconds</INCLUDE>
                <INCLUDE>Deviation</INCLUDE>
                <INCLUDE>PlannedEstimatedTimeAtLocationIsValid</INCLUDE>
                <INCLUDE>Canceled</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>OtherInformation</INCLUDE>
                </QUERY>
            </REQUEST>`;
        let response = await fetch(this._api_url, {method: 'POST',  body: xml});
        return response;
    },
    
    update_departures: function (response) {
        const jsonData = JSON.parse(response.data);
        const announcments = jsonData.RESPONSE.RESULT[0].TrainAnnouncement;

        //filter results
        const current_train_ids = this.current_departures.map(dep => dep.AdvertisedTrainIdent);
        let departures_added = 0;
        const departures = announcments.filter(dep => {
            if (departures_added < this.config.departures && dep.ActivityType == "Avgang")
                if (this.current_train == undefined || moment(dep.AdvertisedTimeAtLocation) >= moment(this.current_train.AdvertisedTimeAtLocation))
                    if (!(current_train_ids.length > 0 && !current_train_ids.includes(dep.AdvertisedTrainIdent))) {
                        departures_added++;
                        return true;
                    }
            return false;
        });

        announcments.forEach(arrival => {
            if (arrival.ActivityType == "Ankomst" && Object.hasOwn(arrival, "TimeAtLocationWithSeconds")) {
                const dep = departures.find(dep => dep.LocationSignature == arrival.LocationSignature);
                if (dep != undefined) {
                    dep.ArrivedTimeAtLocationWithSeconds = arrival.TimeAtLocationWithSeconds;
                } else {
                    const exi_dep = this.current_departures.find(dep => dep.LocationSignature == arrival.LocationSignature);
                    if (exi_dep) {
                        exi_dep.ArrivedTimeAtLocationWithSeconds = arrival.TimeAtLocationWithSeconds;
                        departures.push(exi_dep);
                    }
                }
            }
        });
        
        if (departures.length > 0) {
            //keep current train info updated
            if (this.current_train == undefined || this.current_train.AdvertisedTrainIdent == departures[0].AdvertisedTrainIdent)
                this.current_train = departures[0];
            
            //update table
            this.sendSocketNotification('GOT_DEPARTURES_UPDATE', departures);
            
            //keep current departures updated
            if (this.current_departures.length > 0) {
                departures.forEach(dep => {
                    this.current_departures.forEach(cur => {if (dep.AdvertisedTrainIdent == cur.AdvertisedTrainIdent) cur = dep});
                });
            } else {
                //initialising, assuming there will be result of query
                this.current_departures = departures;
            }

            //check if current train has departed and create new streams
            this.backup_timer_id = clearTimeout(this.backup_timer_id); //note: undefined timer id will be ignored
            if (Object.hasOwn(this.current_train, "TimeAtLocationWithSeconds") || (this.current_train.Canceled && moment(this.current_train.AdvertisedTimeAtLocation) > moment())) {
                this.close_streams();
                setTimeout(() => {this.openStreams();}, 1000*60*1.5); //wait 1.5 minutes before refresh
            } else if (this.current_train.Canceled) {
                this.close_streams();
                const time_to_depart = Math.max(moment(this.current_train.AdvertisedTimeAtLocation) - moment(), 0);
                setTimeout(() => {this.openStreams();}, time_to_depart+1000*60*1.5); //wait til scheduled depart + 1.5 minutes before refresh
            } else {
                //set a backup timeout in case there will be no depart announcment
                const time_to_depart = Math.max(moment(this.current_train.AdvertisedTimeAtLocation) - moment(), 0);
                this.backup_timer_id = setTimeout(() => {this.openStreams();}, time_to_depart+1000*60*15); //wait til scheduled depart + 15 minutes before refresh
            }
        }
    },
    
    update_pre_stations: async function (response) {
        const jsonData = JSON.parse(response.data);
        const announcments = jsonData.RESPONSE.RESULT[0].TrainAnnouncement;
        
        //filter results
        const current_station_ids = this.current_pre_stations.map(station => station.LocationSignature);
        let stations_added = 0;
        const pre_stations = announcments.filter(dep => {
            if (stations_added < this.config.pre_stations && dep.ActivityType == "Avgang")
                if (!(current_station_ids.length > 0 && !current_station_ids.includes(dep.LocationSignature))) {
                    stations_added++;
                    return true;
                }
            return false;
        });

        announcments.forEach(arrival => {
            if (arrival.ActivityType == "Ankomst" && Object.hasOwn(arrival, "TimeAtLocationWithSeconds")) {
                const dep = pre_stations.find(dep => dep.LocationSignature == arrival.LocationSignature);
                if (dep != undefined) {
                    dep.ArrivedTimeAtLocationWithSeconds = arrival.TimeAtLocationWithSeconds;
                } else {
                    const exi_dep = this.current_pre_stations.find(dep => dep.LocationSignature == arrival.LocationSignature);
                    if (exi_dep) {
                        exi_dep.ArrivedTimeAtLocationWithSeconds = arrival.TimeAtLocationWithSeconds;
                        pre_stations.push(exi_dep);
                    }
                }
            }
        });
        
        if (pre_stations.length > 0) {
            //get name for stations
            for (let i = 0; i < pre_stations.length; i++) {
                pre_stations[i].AdvertisedLocationName = await this.get_station_name(pre_stations[i].LocationSignature);
            }
            
            //update table
            this.sendSocketNotification('GOT_PRE_STATIONS_UPDATE', pre_stations);
            
            //keep current pre_stations updated
            if (this.current_pre_stations.length > 0) {
                pre_stations.forEach(dep => {
                    this.current_pre_stations.forEach(cur => {if (dep.LocationSignature == cur.LocationSignature) cur = dep});
                });
            } else {
                //initialising, assuming there will be result of query
                this.current_pre_stations = pre_stations;
            }
        }
    },
    
    openStreams: async function () {
        this.sendSocketNotification('CLEAR_TABLE', undefined);
        this.current_train = undefined;
        this.current_departures = [];
        this.current_pre_stations = [];
        const response = await this.get_departures_stream();
        const jsonData = await response.json();
        this.update_departures({data: JSON.stringify(jsonData)});
        this.dep_es = new EventSource(jsonData.RESPONSE.RESULT[0].INFO.SSEURL);
        this.dep_es.onmessage = (res) => {this.update_departures(res);};
        this.dep_es.onopen = (e) => {console.log("Commute dep connection open");};
        if (this.config.pre_stations > 0) {
            const response2 = await this.get_pre_stations_stream(this.current_train.AdvertisedTrainIdent, this.current_train.AdvertisedTimeAtLocation);
            const jsonData2 = await response2.json();
            this.update_pre_stations({data: JSON.stringify(jsonData2)});
            this.pre_es = new EventSource(jsonData2.RESPONSE.RESULT[0].INFO.SSEURL);
            this.pre_es.onmessage = (res) => {this.update_pre_stations(res);};
            this.pre_es.onopen = (e) => {console.log("Commute pre connection open");};
        }
    },
    
    close_streams: function () {
        if (this.dep_es) this.dep_es.close();
        if (this.pre_es) this.pre_es.close();
        this.dep_es = undefined;
        this.pre_es = undefined;
        console.log("Commute connections closed");
    },
    
    start: function () { },
    
    stop: function () { 
        this.close_streams();
    },
    
    //Subclass socketNotificationReceived received.
    socketNotificationReceived: async function (notification, payload) {
        switch (notification) {
            case "INITIALIZE":
                this.config = payload;
                this.station_from_id = await this.get_station_sign(this.config.station_from);
                this.station_to_id = await this.get_station_sign(this.config.station_to);
                this.openStreams();
                break;
        }
    }
});
