CREATE DATABASE  IF NOT EXISTS `github_statistics` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `github_statistics`;
-- MySQL dump 10.13  Distrib 8.0.38, for Win64 (x86_64)j
--
-- Host: localhost    Database: github_statistics
-- ------------------------------------------------------
-- Server version	9.0.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `release_asserts`
--

DROP TABLE IF EXISTS `release_asserts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `release_asserts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_id` int NOT NULL,
  `release_id` int DEFAULT NULL,
  `asset_name` varchar(255) DEFAULT NULL,
  `asset_content_type` varchar(100) DEFAULT NULL,
  `asset_size` int DEFAULT NULL,
  `asset_download_count` int DEFAULT NULL,
  `asset_created_at` varchar(25) DEFAULT NULL,
  `asset_updated_at` varchar(25) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `release_id` (`release_id`),
  CONSTRAINT `release_asserts_ibfk_1` FOREIGN KEY (`release_id`) REFERENCES `releases` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4935 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `releases`
--

DROP TABLE IF EXISTS `releases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `releases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `release_id` int NOT NULL,
  `repository_id` int DEFAULT NULL,
  `release_name` varchar(255) DEFAULT NULL,
  `tag_name` varchar(100) DEFAULT NULL,
  `prerelease` tinyint(1) DEFAULT NULL,
  `published_at` varchar(25) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `repository_id` (`repository_id`),
  CONSTRAINT `releases_ibfk_1` FOREIGN KEY (`repository_id`) REFERENCES `repository` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3295 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repository`
--

DROP TABLE IF EXISTS `repository`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repository` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `repository_id` int NOT NULL,
  `forks_count` int DEFAULT '0',
  `watchers_count` int DEFAULT '0',
  `stargazers_count` int DEFAULT '0',
  `open_issues_count` int DEFAULT '0',
  `clone_count` int DEFAULT '0',
  `release_assert_download_count` int DEFAULT '0',
  `visibility` varchar(25) DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `org_name` varchar(255) DEFAULT NULL,
  `org_id` int DEFAULT NULL,
  `org_avatar_url` varchar(255) DEFAULT NULL,
  `repository_created_at` varchar(25) DEFAULT NULL,
  `repository_updated_at` varchar(25) DEFAULT NULL,
  `repository_pushed_at` varchar(25) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=314 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repository_daily_increasing_counts`
--

DROP TABLE IF EXISTS `repository_daily_increasing_counts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repository_daily_increasing_counts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `repository_id` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `forks_count` int DEFAULT NULL,
  `watchers_count` int DEFAULT NULL,
  `stargazers_count` int DEFAULT NULL,
  `open_issue_count` int DEFAULT NULL,
  `clone_count` int DEFAULT NULL,
  `release_assert_download_count` int DEFAULT NULL,
  `org_id` int DEFAULT NULL,
  `org_name` varchar(25) DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=512 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2024-09-26 11:09:09