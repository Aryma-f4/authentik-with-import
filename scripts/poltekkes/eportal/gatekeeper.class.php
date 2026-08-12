<?php

   class GateKeeper extends DatabaseConnected
   {
      var $mrConfig;

      var $mDateTimeAcces;
      var $mGateKeeperErrorMessage;

      function GateKeeper(&$configObject)
      {
         $this->mrConfig = &$configObject;
         $this->mDateTimeAcces = date('Y-m-d H:i:s');
         DatabaseConnected::DatabaseConnected($this->mrConfig, "module/login/business/gatekeeper.sql.php");

      }

      function Authenticate($username, $password)
      {
         return $this->AuthenticateUser($username, $password, false);
      }

      /**
       * Build the exact legacy Portal session after Authentik has already
       * authenticated the user.  This deliberately skips all legacy-login
       * database writes (last access and online state).
       */
      function AuthenticateSso($username)
      {
         return $this->AuthenticateUser($username, null, true);
      }

      function AuthenticateUser($username, $password, $trustedSso)
      {
         if(!$this->Connect()) {
            $dbErrorMsg = $this->GetProperty("DbErrorMessage");
            $this->SetProperty("GateKeeperErrorMessage", $dbErrorMsg);
            return false;
         }

         $dataUser = $this->GetAllDataAsArray($this->mSqlQueries['authenticate'], array(mysql_real_escape_string($username)));
         $insertedPassword = $trustedSso ? '' : md5($password);
         if (false !== $dataUser)
         {
            list($row, $value) = each($dataUser);
            if(!$trustedSso && $value['password'] != $insertedPassword) {
               $this->SetProperty("GateKeeperErrorMessage", "Password Anda salah");
               return false;
            }
            else {

               if (!$trustedSso) {
                  // update last access
                  $sqlUpdLastAcces = $this->ExecuteUpdateQuery($this->mSqlQueries['update_last_access_where_user'], array($this->mDateTimeAcces,$username));
                  if(false == $sqlUpdLastAcces)
                     die('Tidak dapat melakukan update last akses. <br />'.$this->GetProperty("DbErrorMessage"));

                  // update online status this user on DB
                  $sqlUpdOnline = $this->ExecuteUpdateQuery($this->mSqlQueries['update_online_status_where_user'], array('1', $username));
                  if(false == $sqlUpdOnline)
                     die('Tidak dapat melakukan update status online'.$this->GetProperty("DbErrorMessage"));
               }

               $serviceSireg = $this->GetAllDataAsArray($this->mSqlQueries['select_service_sireg'], array());
               $serviceFinansi = $this->GetAllDataAsArray($this->mSqlQueries['select_service_finansi'], array());

               //Set User Identity
               $userIdentity = new UserIdentity($value['user'], $value['role']);
               $userIdentity->SetProperty("UserFullName", $value['nama_lengkap']);
               $userIdentity->SetProperty("UserUnitId", $value['unit_id']);
               $userIdentity->SetProperty("UserProdiId", $value['kode_prodi']);
               $userIdentity->SetProperty("UserProdiName", $value["nama_prodi"]);
               $userIdentity->SetProperty("UserReferenceId", $value['referensi_id']);
               $userIdentity->SetProperty("UserFotoFile", $value['foto']);
               $userIdentity->SetProperty("UserIsAgree", $value['is_agree']);
               $userIdentity->SetProperty("ServerServiceAddress", $value['alamat_server']);
               $userIdentity->SetProperty("ApplicationId", $this->mrConfig->GetValue('app_id'));
               $userIdentity->SetProperty("SiregServiceAddress", $serviceSireg[0]['URL']);
               $userIdentity->SetProperty("FinansiServiceAddress", $serviceFinansi[0]['URL']);


               //Get user profil through web services
               $soap_server = $userIdentity->GetProperty("ServerServiceAddress");
               $userClientService = new UserClientService($soap_server, false, $userIdentity->GetProperty("UserReferenceId"));

               if($userClientService->IsError()) {
                  $tmpArray = array('SIA' => false);
                  $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
               }else {
                  $servicePt = $userClientService->GetUserPt();
                  if(false !== $servicePt) {
                     $tmpArray = array('SIA' => true);
                     $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
                     list($row, $value) = each($servicePt);

                     $_SESSION['identitas']['pt_nama'] = $value["pt_nama"];
                     $arrLogo = explode(".", $value["pt_logo"]);
                     $namaLogo = $arrLogo[0];
                     $extLogo  = $arrLogo[1];

                     $_SESSION['identitas']['pt_logo'] = $namaLogo.".".$extLogo;
                     $_SESSION['identitas']['pt_alamat'] = $value["pt_alamat"];
                     $_SESSION['identitas']['pt_alamat_2'] = $value['pt_alamat2'];
                     $_SESSION['identitas']['pt_kota'] = $value["pt_kota"];
                     $_SESSION['identitas']['pt_telp'] = $value["pt_telp"];
                     $_SESSION['identitas']['pt_fax'] = $value["pt_fax"];

                     $_SESSION['identitas']['pt_kode_pos'] = $value['pt_kode_pos'];
                     $_SESSION['identitas']['pt_email'] = $value['pt_email'];
                     $_SESSION['identitas']['pt_web'] = $value['pt_web'];

                     $_SESSION['identitas']['pt_kode_dikti'] = $value['pt_kode_dikti'];
                     $_SESSION['identitas']['pt_yayasan'] = $value['pt_yayasan'];
                     $_SESSION['identitas']['pt_tgl_sk_dikti'] = $value['pt_tgl_sk_dikti'];
                     $_SESSION['identitas']['pt_no_sk_dikti'] = $value['pt_no_sk_dikti'];
                     $_SESSION['identitas']['pt_tgl_berdiri'] = $value['pt_tgl_berdiri'];
                     $_SESSION['identitas']['pt_kontak_person'] = $value['pt_cp'];


                  } else {
                     $tmpArray = array('SIA' => false);
                     $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
                  }

                  // if admin no need to get user profile from service
                  // Role 1 = Mahasiswa
                  // Role 2 = Dosen
                  // Role 3 = Admin
                  if($userIdentity->GetProperty("Role") != 2 && $userIdentity->GetProperty("Role") != 3) { // Role Mahasiswa
                     $userClientService->SetProperty("UserRole", $userIdentity->GetProperty("Role"));
                     $serviceData = $userClientService->GetUserInfo(2);

                     if (false !== $serviceData) {
                        list($row, $value) = each($serviceData);
                        if($value['status_aktif'] == 'A' || $value['status_aktif'] == 'C'){
                           // P17230182016
                           $tmpArray = array('SIA' => true);
                           $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);

                           $userIdentity->SetProperty("UserIdNumber", $value["no_id"]);
                           $userIdentity->SetProperty("UserFullName", $value["fullname"]);
                           $userIdentity->SetProperty("UserProdiId", $value["prodiKode"]);
                           $userIdentity->SetProperty("UserProdiName", $value["info"]);
                           $userIdentity->SetProperty("UserFotoFile", $value["foto"]);
                           $userIdentity->SetProperty("IsEditBiodata", $value["is_edit_biodata"]);
                        }elseif($value['status_aktif'] == 'L'){
                          if($value["tgl_lulus"] >= $value["tgl_skrg"]){
                            $tmpArray = array('SIA' => true);
                            $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);

                            $userIdentity->SetProperty("UserIdNumber", $value["no_id"]);
                            $userIdentity->SetProperty("UserFullName", $value["fullname"]);
                            $userIdentity->SetProperty("UserProdiId", $value["prodiKode"]);
                            $userIdentity->SetProperty("UserProdiName", $value["info"]);
                            $userIdentity->SetProperty("UserFotoFile", $value["foto"]);
                            $userIdentity->SetProperty("IsEditBiodata", $value["is_edit_biodata"]);
                          }else{
                            $this->SetProperty("GateKeeperErrorMessage", "Status Mahasiswa sudah Lulus atau Tidak Aktif");
                            return false;
                          }
                        } else {
                           $this->SetProperty("GateKeeperErrorMessage", "Status Mahasiswa sudah Lulus atau Tidak Aktif");
                           return false;
                        }
                     } else {
                        $tmpArray = array('SIA' => false);
                        $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
                     }

                  } else if($userIdentity->GetProperty("Role") != 1 && $userIdentity->GetProperty("Role") != 3) { // Role Dosen
                     $userClientService->SetProperty("UserRole", $userIdentity->GetProperty("Role"));
                     $serviceData = $userClientService->GetUserInfo(2);

                     if (false !== $serviceData) {
                        list($row, $value) = each($serviceData);
                        if($value['status_aktif'] == 'A' || $value['status_aktif'] == 'C' || $value['status_aktif'] == 'I' || $value['status_aktif'] == 'S' || $value['status_aktif'] == 'T'){
                           $tmpArray = array('SIA' => true);
                           $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);

                           $userIdentity->SetProperty("UserIdNumber", $value["no_id"]);
                           $userIdentity->SetProperty("UserFullName", $value["fullname"]);
                           $userIdentity->SetProperty("UserProdiId", $value["prodiKode"]);
                           $userIdentity->SetProperty("UserProdiName", $value["info"]);
                           $userIdentity->SetProperty("UserFotoFile", $value["foto"]);
                           $userIdentity->SetProperty("IsEditBiodata", $value["is_edit_biodata"]);
                        } else {
                           $this->SetProperty("GateKeeperErrorMessage", "Dosen Sudah Tidak Aktif");
                           return false;
                        }
                     } else {
                        $tmpArray = array('SIA' => false);
                        $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
                     }

                  } else { // Role Admin
                     if ($userIdentity->GetProperty("Role") == 3){
                        $userIdentity->SetProperty("UserProdiId", "PORTAL");
                     }
                     $tmpArray = array('SIA' => false);
                     $userIdentity->SetProperty("ServerServiceAvailable", $tmpArray);
                  }

                    # Deklarasi KodeClientCetak melalui siaSettingClientServece ============ (BEGIN)
                    $siaSettingClientService = new siaSettingClientService($soap_server, false, $userIdentity->GetProperty("UserReferenceId"),$userIdentity->GetProperty("UserProdiId"));
                    $siaSetting = $siaSettingClientService->GetSiaSettingRef(6);
                    if($siaSetting[0]['SET_NAMA'] != 'KodeClientCetakAkademik'){
                        $KodeClientCetak = 'general';
                    }else{
                        if($siaSetting[0]['SET_KODE'] == 0)
                            $KodeClientCetak = 'general';
                        else
                            $KodeClientCetak = $siaSetting[0]['SET_KETERANGAN'];
                    }
                    $_SESSION['KodeClientCetak'] = $KodeClientCetak;
                    # Deklarasi KodeClientCetak melalui siaSettingClientServece ============ (END)

                    # Session data program studi
                    $siaProgramStudi = $siaSettingClientService->GetSiaProgramStudi();
                    $_SESSION['data_prodi'] = $siaProgramStudi;
               }

               $_SESSION['user_identity_portal'] = $userIdentity;

               //print_r($_SESSION['user_identity_portal']);exit;
               //Get Role Base
               $userRole = new Role($this->mDbConnection, $this->mrConfig);
               $_SESSION['role_base_portal'] = $userRole->FetchRole();
               $this->SetProperty("GateKeeperErrorMessage", "");
               $this->Disconnect();
               return true;
            }
         } else {
            $this->Disconnect();
            $dbErrorMsg = $this->GetProperty("DbErrorMessage");
            $this->SetProperty("GateKeeperErrorMessage", "Username $username belum terdaftar<br>".$dbErrorMsg);
            return false;
         }
      }

      /**
       * GateKeeper::DoLogoutUser
       * Logouting user by set online status = 0
       *
       * @param userName string username
       * @return boolean logout result
       */
      function DoLogoutUser($userName)
      {
         $sql = sprintf($this->mSqlQueries['update_online_status_where_user'], '0', $userName);
         $this->Connect();
         $rs = $this->mDbConnection->Execute($sql);
         $this->Disconnect();
         if ($rs){
            return true;
         }else{
            return false;
         }
      }

      //kayaknya ga perlu dipake
      /**
       * GateKeeper::UserNameAuthenticate
       * Check the existing of username
       *
       * @param userName string username
       * @return flag 0 and 1 indicating not exist and exist
       */
      function UserNameAuthenticate($userName){
         $sql = sprintf($this->mSqlQueries['select_user_where_user_name'], '0', $userName);
         $this->Connect();
         $rs = $this->mDbConnection->Execute($sql);
         $this->Disconnect();
         if ($rs){
            return $rs[0]["JUMLAH"];
         }else{
            return 0;
         }
      }

      function DoRegisterUserSessionId($sessionId, $username) {

         $this->Connect();
         $rs = $this->ExecuteInsertQuery($this->mSqlQueries['do_register_user_session_id'], array($sessionId, $username));
         $this->Disconnect();
         if ($rs === false) {
            $this->SetProperty("GateKeeperErrorMessage", $this->GetProperty("DbErrorMessage"));
         } else {
            $this->SetProperty("GateKeeperErrorMessage", '');
         }
         return $rs;
      }

      function DoUnregisterUserSessionId($sessionId)
      {
         $this->Connect();
         $rs = $this->ExecuteDeleteQuery($this->mSqlQueries['do_unregister_user_session_id'], array($sessionId));
         $this->Disconnect();
         if ($rs === false) {
            $this->SetProperty("GateKeeperErrorMessage", $this->GetProperty("DbErrorMessage"));
         } else {
            $this->SetProperty("GateKeeperErrorMessage", '');
         }
         return $rs;
      }

      function IsUserSessionRegistered($sessionId) {
         $this->Connect();
         $rs = $this->GetDataAsOne($this->mSqlQueries['is_user_session_registered'], array($sessionId));
         $this->Disconnect();
         if ($rs === false) {
            $this->SetProperty("GateKeeperErrorMessage", $this->GetProperty("DbErrorMessage"));
            return false;
         } else {
            $this->SetProperty("GateKeeperErrorMessage", '');
            return $rs;
         }
      }
   }
?>
