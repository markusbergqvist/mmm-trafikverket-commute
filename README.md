# mmm-trafikverket-commute

Magic Mirror module for showing swedish long distance train information.

This module can be configured to show all announcments for trains running between two stations. This is useful if you commute. It can also be configured to show announcments for a number of stations ahead of your home station, that way you can confirm that your indended train is on schedule and in case of delays you can leave home later and avoid waiting at the train station.

Required API key can be obtained for free here https://api.trafikinfo.trafikverket.se/Account/Register


Config:
    api_key: "YOUR_API_KEY", //obtain from https://api.trafikinfo.trafikverket.se/Account/Register
    station_from: "Stockholm C", //your home station. See 'station_id_cache.json' for valid names
    station_to: "Göteborg", //your destination station. Use a nearby station if you dont get any results
    departures: 8, //number of departures from your home station to show
    pre_stations: 2, //number of stations before your home station to show
    show_track: true, //show track numbers
    show_other_information: false, //show less important information
    show_update_timer: true //show time since last update received


Known issues:
Destination station has to be listed as one of the upcoming stations for the train on the information screens at your train station. That means you might have to enter a "more significant" station as your destination. In that case, choose a station just before or after your destination that all your indended trains also will arrive at.

Only one instance is supported at the moment

